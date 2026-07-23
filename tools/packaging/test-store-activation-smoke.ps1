param(
  [string]$PackageName,
  [string]$AppId,
  [string]$DisplayName,
  [int]$HoldSeconds = 10,
  [switch]$StopExisting,
  [switch]$LeaveRunning
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($PSVersionTable.PSEdition -eq "Core") {
  throw "Run this script with Windows PowerShell, not PowerShell Core, so the Appx module is available."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "store-package-helpers.ps1")
$builderConfigPath = Join-Path $root "packaging\electron-builder.json"
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $root "out\store-activation-smoke\$runId"
$mainLog = Join-Path $env:LOCALAPPDATA "Soapy Panels\logs\main.log"
$launcherLog = Join-Path $env:LOCALAPPDATA "Soapy Panels\logs\store-launcher.log"
$badLogPattern = "render-process-gone|child-process-gone|uncaughtException|unhandledRejection"
$directElectronExecutable = "app\SoapyPanels.exe"
$storeLauncherExecutable = "app\resources\store-launcher\SoapyStoreLauncher.exe"

function Get-RequiredConfigValue($Name, $Value) {
  $stringValue = [string]$Value
  if ([string]::IsNullOrWhiteSpace($stringValue)) {
    throw "Electron Builder appx.$Name must be a non-empty string."
  }
  return $stringValue
}

$builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw | ConvertFrom-Json
$appxConfig = $builderConfig.appx

if (-not $PackageName) {
  $PackageName = Get-RequiredConfigValue "identityName" $appxConfig.identityName
}
if (-not $AppId) {
  $AppId = Get-RequiredConfigValue "applicationId" $appxConfig.applicationId
}
if (-not $DisplayName) {
  $DisplayName = Get-RequiredConfigValue "displayName" $appxConfig.displayName
}

$expectedAppxVersion = Get-SoapyExpectedAppxVersion
$expectedPackageFamilyName = Get-SoapyExpectedPackageFamilyName
$expectedSignatureKind = Get-SoapyExpectedSignatureKind
$expectedAumid = Get-SoapyExpectedAumid -ApplicationId $AppId
$latestProvenance = Get-SoapyLatestPackageProvenance

function Write-Section {
  param([string]$Text)
  Write-Output ""
  Write-Output "=== $Text ==="
}

function Format-HResult {
  param([int]$Value)
  return ("0x{0:X8}" -f ($Value -band 0xffffffff))
}

function Select-ApplicationById {
  param(
    [xml]$Manifest,
    [string]$ApplicationId
  )

  $applications = $Manifest.SelectNodes("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
  foreach ($candidate in $applications) {
    if ($candidate.GetAttribute("Id") -eq $ApplicationId) {
      return $candidate
    }
  }
  return $null
}

function Format-StartApps {
  param($Apps)

  $lines = @(
    $Apps |
      ForEach-Object { "Name='$($_.Name)' AppID='$($_.AppID)'" }
  )
  if ($lines.Count -eq 0) {
    return "(none)"
  }
  return ($lines -join "; ")
}

function Get-TargetProcesses {
  param(
    [string]$InstalledPackageName,
    [string]$PackageFamilyName,
    [uint32]$LaunchedProcessId = 0
  )

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($LaunchedProcessId -ne 0 -and $_.ProcessId -eq $LaunchedProcessId) -or
      ($_.ExecutablePath -like "*WindowsApps*$InstalledPackageName*") -or
      ($_.CommandLine -like "*$PackageFamilyName*") -or
      ($_.CommandLine -like "*$InstalledPackageName*")
    }
}

function Stop-TargetProcesses {
  param(
    [string]$InstalledPackageName,
    [string]$PackageFamilyName,
    [uint32]$LaunchedProcessId = 0
  )

  Get-TargetProcesses `
    -InstalledPackageName $InstalledPackageName `
    -PackageFamilyName $PackageFamilyName `
    -LaunchedProcessId $LaunchedProcessId |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      } catch {}
    }
}

function Read-NewLogText {
  param(
    [string]$Path,
    [long]$PreviousLength
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return ""
  }

  $text = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if (-not $text) {
    return ""
  }

  if ($PreviousLength -gt 0 -and $text.Length -gt $PreviousLength) {
    return $text.Substring([int]$PreviousLength)
  }

  if ($PreviousLength -eq 0) {
    return $text
  }

  return ""
}

function Save-RecentEvents {
  param(
    [datetime]$Since,
    [string]$OutputDir
  )

  $eventLogs = @(
    "Microsoft-Windows-TWinUI/Operational",
    "Microsoft-Windows-Shell-Core/Operational",
    "Microsoft-Windows-AppReadiness/Admin",
    "Microsoft-Windows-AppModel-Runtime/Admin",
    "Microsoft-Windows-AppXDeploymentServer/Operational",
    "Application"
  )

  foreach ($eventLog in $eventLogs) {
    $safeName = $eventLog -replace '[^a-zA-Z0-9_-]', '_'
    $outFile = Join-Path $OutputDir "$safeName.txt"

    try {
      $events = Get-WinEvent -LogName $eventLog -MaxEvents 300 -ErrorAction Stop |
        Where-Object {
          $_.TimeCreated -ge $Since -and
          (
            $_.Message -match "Soapy|SoapyPanels|Soapy Panels|0x80070005|0x80270254|0x490" -or
            $_.ProviderName -match "Application Error|Windows Error Reporting"
          )
        } |
        Select-Object TimeCreated, Id, ProviderName, LevelDisplayName, Message

      if ($events) {
        $events | Format-List | Out-String | Set-Content -LiteralPath $outFile
      } else {
        "No matching events found after $($Since.ToString("o"))." | Set-Content -LiteralPath $outFile
      }
    } catch {
      "Unable to read $eventLog. $($_.Exception.Message)" | Set-Content -LiteralPath $outFile
    }
  }
}

$activationType = @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
  [PreserveSig]
  int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);

  [PreserveSig]
  int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, IntPtr itemArray, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);

  [PreserveSig]
  int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, IntPtr itemArray, out uint processId);
}

[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
class ApplicationActivationManager {}

public static class SoapyStoreActivationSmoke {
  public static int Activate(string appId, out uint launchedProcessId) {
    var manager = (IApplicationActivationManager)new ApplicationActivationManager();
    return manager.ActivateApplication(appId, null, 0, out launchedProcessId);
  }
}
"@

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Add-Type -TypeDefinition $activationType

$pkg = Get-AppxPackage -Name $PackageName | Select-Object -First 1
if (-not $pkg) {
  throw "Package '$PackageName' is not installed."
}

$aumid = $expectedAumid
$manifestPath = Join-Path $pkg.InstallLocation "AppxManifest.xml"
$manifestApplicationId = ""
$manifestApplicationExecutable = ""
$installedManifestSummary = $null
$registeredStartApps = @()
$matchingStartApps = @()
$soapyStartApps = @()

if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
  $installedManifestSummary = Get-SoapyManifestSummaryFromManifestPath -ManifestPath $manifestPath -ApplicationId $AppId
  [xml]$installedManifest = Get-Content -LiteralPath $manifestPath -Raw
  $manifestApplication = Select-ApplicationById -Manifest $installedManifest -ApplicationId $AppId
  if ($manifestApplication) {
    $manifestApplicationId = $manifestApplication.GetAttribute("Id")
    $manifestApplicationExecutable = $manifestApplication.GetAttribute("Executable")
  }
}

$registeredStartApps = @(Get-StartApps -ErrorAction SilentlyContinue)
$matchingStartApps = @($registeredStartApps | Where-Object { $_.AppID -eq $aumid })
$soapyStartApps = @(
  $registeredStartApps |
    Where-Object {
      $_.Name -eq $DisplayName -or
      $_.Name -like "*Soapy*" -or
      $_.AppID -like "*Soapy*" -or
      $_.AppID -like "*$expectedPackageFamilyName*" -or
      $_.AppID -like "*$($pkg.PackageFamilyName)*" -or
      $_.AppID -like "*$PackageName*"
    }
)
$before = Get-Date
$beforeLogLength = 0
$beforeLogWriteTime = $null
$beforeLauncherLogLength = 0
$beforeLauncherLogWriteTime = $null

if (Test-Path -LiteralPath $mainLog -PathType Leaf) {
  $beforeLog = Get-Item -LiteralPath $mainLog
  $beforeLogLength = $beforeLog.Length
  $beforeLogWriteTime = $beforeLog.LastWriteTime
}
if (Test-Path -LiteralPath $launcherLog -PathType Leaf) {
  $beforeLauncherLog = Get-Item -LiteralPath $launcherLog
  $beforeLauncherLogLength = $beforeLauncherLog.Length
  $beforeLauncherLogWriteTime = $beforeLauncherLog.LastWriteTime
}

Write-Section "Target"
Write-Output "PackageName: $($pkg.Name)"
Write-Output "PackageFullName: $($pkg.PackageFullName)"
Write-Output "PackageFamilyName: $($pkg.PackageFamilyName)"
Write-Output "Expected PackageFamilyName: $expectedPackageFamilyName"
Write-Output "Version: $($pkg.Version)"
Write-Output "Expected Version: $expectedAppxVersion"
Write-Output "InstallLocation: $($pkg.InstallLocation)"
Write-Output "SignatureKind: $($pkg.SignatureKind)"
Write-Output "Expected SignatureKind: $expectedSignatureKind"
Write-Output "Status: $($pkg.Status)"
Write-Output "AppUserModelID: $aumid"
Write-Output "Expected Application Id: $AppId"
Write-Output "Installed manifest Application Id: $manifestApplicationId"
Write-Output "Installed manifest Executable: $manifestApplicationExecutable"
Write-Output "Registered Start AUMID: $(if ($matchingStartApps.Count -gt 0) { ($matchingStartApps.AppID -join ', ') } else { '(missing)' })"
Write-Output "Launcher log: $launcherLog"
Write-Output "Main log: $mainLog"
Write-Output "Smoke log folder: $logDir"

Write-Section "Identity Diagnostics"
Write-Output "Expected AUMID: $aumid"
Write-Output "Expected PackageFamilyName: $expectedPackageFamilyName"
Write-Output "Expected SignatureKind: $expectedSignatureKind"
Write-Output "Installed manifest path: $manifestPath"
Write-Output "Installed manifest Application Id: $(if ($manifestApplicationId) { $manifestApplicationId } else { '(missing)' })"
Write-Output "Installed manifest Executable: $(if ($manifestApplicationExecutable) { $manifestApplicationExecutable } else { '(missing)' })"
Write-Output "Latest provenance: $(if ($latestProvenance) { $latestProvenance.PackagePath } else { '(missing)' })"
Write-Output "Matching Start entries: $(Format-StartApps $matchingStartApps)"
Write-Output "Soapy Start entries: $(Format-StartApps $soapyStartApps)"

$identityFailures = New-Object 'System.Collections.Generic.List[string]'
if ([string]$pkg.PackageFamilyName -ne $expectedPackageFamilyName) {
  $identityFailures.Add("Installed PackageFamilyName is '$($pkg.PackageFamilyName)', expected '$expectedPackageFamilyName'.") | Out-Null
}
if ([string]$pkg.SignatureKind -ne $expectedSignatureKind) {
  $identityFailures.Add("Installed SignatureKind is '$($pkg.SignatureKind)', expected '$expectedSignatureKind'.") | Out-Null
}
if ("$($pkg.Version)" -ne $expectedAppxVersion) {
  $identityFailures.Add("Installed package version is '$($pkg.Version)', expected current package version '$expectedAppxVersion'.") | Out-Null
}
if (-not $manifestApplicationId) {
  $identityFailures.Add("Installed manifest does not contain Application Id '$AppId'.") | Out-Null
}
if ($manifestApplicationId -and $manifestApplicationId -ne $AppId) {
  $identityFailures.Add("Installed manifest Application Id is '$manifestApplicationId', expected '$AppId'.") | Out-Null
}
if ($matchingStartApps.Count -eq 0) {
  $identityFailures.Add("Get-StartApps does not expose expected AUMID '$aumid'.") | Out-Null
  if ($soapyStartApps.Count -gt 0) {
    $identityFailures.Add("Soapy Start entry exists with a different AUMID: $(Format-StartApps $soapyStartApps)") | Out-Null
  }
}
if (-not $latestProvenance) {
  $identityFailures.Add("Latest Store package provenance was not found. Run npm run store:package before activation smoke testing.") | Out-Null
} else {
  if ([string]$latestProvenance.ExpectedAppxVersion -ne $expectedAppxVersion) {
    $identityFailures.Add("Latest provenance expected AppX version is '$($latestProvenance.ExpectedAppxVersion)', expected '$expectedAppxVersion'.") | Out-Null
  }
  if ($installedManifestSummary) {
    $manifestDifferences = Compare-SoapyManifestSummaryCore -Expected $latestProvenance.ManifestSummary -Actual $installedManifestSummary
    foreach ($difference in $manifestDifferences) {
      $identityFailures.Add("Installed manifest differs from latest package provenance: $difference") | Out-Null
    }
  }
}

if ($identityFailures.Count -gt 0) {
  Write-Section "Result"
  foreach ($failure in $identityFailures) {
    Write-Output "FAIL: $failure"
  }
  Write-Output "Activation was not attempted because Store identity registration did not match the expected AUMID."
  Write-Output "If this package was already rebuilt and installed, run npm run store:registration-reset, reinstall the intended Store/test-flight package, then rerun npm run store:activation-smoke."
  Write-Output "Event and log details were saved under: $logDir"
  Save-RecentEvents -Since $before -OutputDir $logDir
  exit 1
}

$usesDirectElectronEntrypoint = $manifestApplicationExecutable -eq $directElectronExecutable
$requiresLauncherLog = $manifestApplicationExecutable -eq $storeLauncherExecutable

if ($StopExisting) {
  Write-Section "Stop Existing Processes"
  Stop-TargetProcesses `
    -InstalledPackageName $pkg.Name `
    -PackageFamilyName $pkg.PackageFamilyName
  Start-Sleep -Seconds 2
}

Write-Section "Activate"
$launchedProcessId = [uint32]0
$activationHResult = [SoapyStoreActivationSmoke]::Activate($aumid, [ref]$launchedProcessId)
$activationHResultHex = Format-HResult $activationHResult
Write-Output "Activation HRESULT: $activationHResultHex"
Write-Output "Launched PID: $launchedProcessId"

$processSeen = $false
$seenProcesses = @()
$deadline = (Get-Date).AddSeconds($HoldSeconds)

do {
  Start-Sleep -Milliseconds 500
  $seenProcesses = @(
    Get-TargetProcesses `
      -InstalledPackageName $pkg.Name `
      -PackageFamilyName $pkg.PackageFamilyName `
      -LaunchedProcessId $launchedProcessId
  )

  if ($seenProcesses.Count -gt 0) {
    $processSeen = $true
    break
  }
} while ((Get-Date) -lt $deadline)

Start-Sleep -Seconds 1

$afterLogLength = 0
$afterLogWriteTime = $null
$afterLauncherLogLength = 0
$afterLauncherLogWriteTime = $null
if (Test-Path -LiteralPath $mainLog -PathType Leaf) {
  $afterLog = Get-Item -LiteralPath $mainLog
  $afterLogLength = $afterLog.Length
  $afterLogWriteTime = $afterLog.LastWriteTime
}
if (Test-Path -LiteralPath $launcherLog -PathType Leaf) {
  $afterLauncherLog = Get-Item -LiteralPath $launcherLog
  $afterLauncherLogLength = $afterLauncherLog.Length
  $afterLauncherLogWriteTime = $afterLauncherLog.LastWriteTime
}

$newLauncherLogText = Read-NewLogText -Path $launcherLog -PreviousLength $beforeLauncherLogLength
$newMainLogText = Read-NewLogText -Path $mainLog -PreviousLength $beforeLogLength
$freshLauncherLogged = $newLauncherLogText -match "start pid=|child-started|fatal|error"
$freshBootLogged = $newMainLogText -match "app\.whenReady appPath"
$badLogMarker = $newMainLogText -match $badLogPattern

if ($newLauncherLogText) {
  $newLauncherLogText | Set-Content -LiteralPath (Join-Path $logDir "store-launcher-log-new-lines.txt")
} else {
  if ($requiresLauncherLog) {
    "No new store-launcher.log content was written during this activation attempt." |
      Set-Content -LiteralPath (Join-Path $logDir "store-launcher-log-new-lines.txt")
  } else {
    "No store-launcher.log content was expected because the installed manifest executable is '$manifestApplicationExecutable'." |
      Set-Content -LiteralPath (Join-Path $logDir "store-launcher-log-new-lines.txt")
  }
}
if ($newMainLogText) {
  $newMainLogText | Set-Content -LiteralPath (Join-Path $logDir "main-log-new-lines.txt")
} else {
  "No new main.log content was written during this activation attempt." |
    Set-Content -LiteralPath (Join-Path $logDir "main-log-new-lines.txt")
}

Save-RecentEvents -Since $before -OutputDir $logDir

Write-Section "Observed Processes"
if ($seenProcesses.Count -gt 0) {
  $seenProcesses |
    Select-Object Name, ProcessId, ExecutablePath, CommandLine |
    Format-List
} else {
  Write-Output "No Soapy package process was observed."
}

Write-Section "Store Launcher Log"
Write-Output "Before LastWriteTime: $beforeLauncherLogWriteTime"
Write-Output "Before Length: $beforeLauncherLogLength"
Write-Output "After LastWriteTime: $afterLauncherLogWriteTime"
Write-Output "After Length: $afterLauncherLogLength"
Write-Output "Direct Electron entrypoint observed: $usesDirectElectronEntrypoint"
Write-Output "Launcher log required: $requiresLauncherLog"
Write-Output "Fresh launcher log observed: $freshLauncherLogged"

Write-Section "Main Log"
Write-Output "Before LastWriteTime: $beforeLogWriteTime"
Write-Output "Before Length: $beforeLogLength"
Write-Output "After LastWriteTime: $afterLogWriteTime"
Write-Output "After Length: $afterLogLength"
Write-Output "Fresh boot log observed: $freshBootLogged"
Write-Output "Bad log marker observed in new lines: $badLogMarker"

Write-Section "Result"
$failures = New-Object 'System.Collections.Generic.List[string]'

if ($activationHResult -ne 0) {
  $failures.Add("Activation returned $activationHResultHex.") | Out-Null
}
if ($launchedProcessId -eq 0) {
  $failures.Add("Activation did not return a launched process ID.") | Out-Null
}
if (-not $processSeen) {
  $failures.Add("No Soapy package process was observed within $HoldSeconds seconds.") | Out-Null
}
if ($requiresLauncherLog -and -not $freshLauncherLogged) {
  $failures.Add("No fresh Store launcher log was written.") | Out-Null
}
if (-not $freshBootLogged) {
  $failures.Add("No fresh main-process boot log was written.") | Out-Null
}
if ($badLogMarker) {
  $failures.Add("A crash/error marker was written to main.log.") | Out-Null
}

if ($failures.Count -gt 0) {
  foreach ($failure in $failures) {
    Write-Output "FAIL: $failure"
  }
  Write-Output "Event and log details were saved under: $logDir"
  exit 1
}

Write-Output "Store activation smoke test passed."
Write-Output "Event and log details were saved under: $logDir"

if (-not $LeaveRunning) {
  Stop-TargetProcesses `
    -InstalledPackageName $pkg.Name `
    -PackageFamilyName $pkg.PackageFamilyName `
    -LaunchedProcessId $launchedProcessId
}

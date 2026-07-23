param(
  [string]$PackageName,
  [string]$AppId,
  [string]$DisplayName,
  [string]$PackagePath,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($PSVersionTable.PSEdition -eq "Core") {
  throw "Run this script with Windows PowerShell, not PowerShell Core, so the Appx module is available."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "store-package-helpers.ps1")

$builderConfig = Get-SoapyBuilderAppxConfig
if (-not $PackageName) { $PackageName = [string]$builderConfig.identityName }
if (-not $AppId) { $AppId = [string]$builderConfig.applicationId }
if (-not $DisplayName) { $DisplayName = [string]$builderConfig.displayName }

if ([string]::IsNullOrWhiteSpace($PackageName)) {
  throw "Electron Builder appx.identityName must be a non-empty string."
}
if ([string]::IsNullOrWhiteSpace($AppId)) {
  throw "Electron Builder appx.applicationId must be a non-empty string."
}
if ([string]::IsNullOrWhiteSpace($DisplayName)) {
  throw "Electron Builder appx.displayName must be a non-empty string."
}

$expectedAppxVersion = Get-SoapyExpectedAppxVersion
$expectedPackageFamilyName = Get-SoapyExpectedPackageFamilyName
$expectedSignatureKind = Get-SoapyExpectedSignatureKind
$expectedAumid = Get-SoapyExpectedAumid -ApplicationId $AppId
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $root "out\store-registration-reset\$runId"
$operationStart = Get-Date
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Section {
  param([string]$Text)
  Write-Output ""
  Write-Output "=== $Text ==="
}

function Resolve-PackagePath {
  param([string]$Path)

  if (-not $Path) {
    return $null
  }

  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    $Path = Join-Path $root $Path
  }

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "PackagePath was not found: $Path"
  }

  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($extension -notin @(".appx", ".msix")) {
    throw "PackagePath must be an installable .appx or .msix file, not '$extension'. Store upload packages are not installable with Add-AppxPackage."
  }

  return (Get-Item -LiteralPath $Path).FullName
}

function Get-InstalledPackage {
  Get-AppxPackage -Name $PackageName |
    Sort-Object Version -Descending |
    Select-Object -First 1
}

function Get-SoapyStartApps {
  param([string]$PackageFamilyName)

  @(Get-StartApps -ErrorAction SilentlyContinue) |
    Where-Object {
      $_.Name -eq $DisplayName -or
      $_.Name -like "*Soapy*" -or
      $_.AppID -like "*Soapy*" -or
      ($PackageFamilyName -and $_.AppID -like "*$PackageFamilyName*") -or
      $_.AppID -like "*$PackageName*"
    }
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

function Get-RegistrationState {
  param([string]$Label)

  $packageRows = @(
    Get-AppxPackage -Name $PackageName |
      Select-Object Name,
        PackageFullName,
        PackageFamilyName,
        Version,
        Publisher,
        Architecture,
        ResourceId,
        IsFramework,
        InstallLocation,
        SignatureKind,
        Status
  )
  $packageRows |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (Join-Path $logDir "$Label-GetAppxPackage.json") -Encoding UTF8

  $pkg = Get-InstalledPackage
  $manifestSummary = $null
  $manifestPath = ""
  $aumid = ""
  $matchingStartApps = @()
  $soapyStartApps = @()

  if ($pkg) {
    $aumid = "$($pkg.PackageFamilyName)!$AppId"
    $manifestPath = Join-Path $pkg.InstallLocation "AppxManifest.xml"
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $logDir "$Label-AppxManifest.xml") -Force
      $manifestSummary = Get-SoapyManifestSummaryFromManifestPath `
        -ManifestPath $manifestPath `
        -ApplicationId $AppId
    }
    $matchingStartApps = @(Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.AppID -eq $expectedAumid })
    $soapyStartApps = @(Get-SoapyStartApps -PackageFamilyName $pkg.PackageFamilyName)
  } else {
    $soapyStartApps = @(Get-SoapyStartApps -PackageFamilyName "")
  }

  @($soapyStartApps | Select-Object Name, AppID) |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $logDir "$Label-GetStartApps.json") -Encoding UTF8

  $state = [pscustomobject][ordered]@{
    Label = $Label
    CapturedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    ExpectedPackageName = $PackageName
    ExpectedAppId = $AppId
    ExpectedDisplayName = $DisplayName
    ExpectedAppxVersion = $expectedAppxVersion
    ExpectedPackageFamilyName = $expectedPackageFamilyName
    ExpectedSignatureKind = $expectedSignatureKind
    ExpectedAUMID = $expectedAumid
    PackageInstalled = [bool]$pkg
    PackageFullName = if ($pkg) { $pkg.PackageFullName } else { "" }
    PackageFamilyName = if ($pkg) { $pkg.PackageFamilyName } else { "" }
    PackageFamilyNameMatchesExpected = if ($pkg) { [string]$pkg.PackageFamilyName -eq $expectedPackageFamilyName } else { $false }
    Version = if ($pkg) { [string]$pkg.Version } else { "" }
    InstallLocation = if ($pkg) { $pkg.InstallLocation } else { "" }
    SignatureKind = if ($pkg) { [string]$pkg.SignatureKind } else { "" }
    SignatureKindMatchesExpected = if ($pkg) { [string]$pkg.SignatureKind -eq $expectedSignatureKind } else { $false }
    Status = if ($pkg) { [string]$pkg.Status } else { "" }
    AUMID = $aumid
    ManifestPath = $manifestPath
    ManifestSummary = $manifestSummary
    MatchingStartApps = @($matchingStartApps | Select-Object Name, AppID)
    SoapyStartApps = @($soapyStartApps | Select-Object Name, AppID)
  }

  $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $logDir "$Label.json") -Encoding UTF8
  return $state
}

function Get-TargetProcesses {
  param(
    [string]$InstalledPackageName,
    [string]$PackageFamilyName
  )

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.ExecutablePath -like "*WindowsApps*$InstalledPackageName*") -or
      ($PackageFamilyName -and $_.CommandLine -like "*$PackageFamilyName*") -or
      ($_.CommandLine -like "*$InstalledPackageName*")
    }
}

function Stop-TargetProcesses {
  param($State)

  if (-not $State.PackageInstalled) {
    return
  }

  Get-TargetProcesses `
    -InstalledPackageName $PackageName `
    -PackageFamilyName $State.PackageFamilyName |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        Write-Output "Stopped process $($_.ProcessId) $($_.Name)"
      } catch {
        Write-Output "Unable to stop process $($_.ProcessId): $($_.Exception.Message)"
      }
    }
}

function Save-RecentEvents {
  param([datetime]$Since)

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
    $outFile = Join-Path $logDir "$safeName.txt"

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

function Wait-ForCurrentUserRemoval {
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $state = Get-RegistrationState -Label "after-remove"
    if (-not $state.PackageInstalled -and $state.SoapyStartApps.Count -eq 0) {
      return $state
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  return Get-RegistrationState -Label "after-remove"
}

function Write-StateSummary {
  param($State)

  Write-Output "PackageInstalled: $($State.PackageInstalled)"
  Write-Output "PackageFullName: $($State.PackageFullName)"
  Write-Output "PackageFamilyName: $($State.PackageFamilyName)"
  Write-Output "Expected PackageFamilyName: $($State.ExpectedPackageFamilyName)"
  Write-Output "PackageFamilyName matches expected: $($State.PackageFamilyNameMatchesExpected)"
  Write-Output "Version: $($State.Version)"
  Write-Output "SignatureKind: $($State.SignatureKind)"
  Write-Output "Expected SignatureKind: $($State.ExpectedSignatureKind)"
  Write-Output "SignatureKind matches expected: $($State.SignatureKindMatchesExpected)"
  Write-Output "Status: $($State.Status)"
  Write-Output "AUMID: $($State.AUMID)"
  Write-Output "Expected AUMID: $($State.ExpectedAUMID)"
  Write-Output "Matching Start apps: $(Format-StartApps $State.MatchingStartApps)"
  Write-Output "Soapy Start apps: $(Format-StartApps $State.SoapyStartApps)"
}

$resolvedPackagePath = Resolve-PackagePath -Path $PackagePath

Write-Section "Registration Target"
Write-Output "PackageName: $PackageName"
Write-Output "ApplicationId: $AppId"
Write-Output "DisplayName: $DisplayName"
Write-Output "Expected AppX Version: $expectedAppxVersion"
Write-Output "Expected PackageFamilyName: $expectedPackageFamilyName"
Write-Output "Expected SignatureKind: $expectedSignatureKind"
Write-Output "Expected AUMID: $expectedAumid"
Write-Output "CheckOnly: $CheckOnly"
Write-Output "PackagePath: $(if ($resolvedPackagePath) { $resolvedPackagePath } else { '(none)' })"
Write-Output "Log folder: $logDir"

$beforeState = Get-RegistrationState -Label "before"
Write-Section "Before"
Write-StateSummary -State $beforeState

if ($CheckOnly) {
  Save-RecentEvents -Since $operationStart
  Write-Section "Result"
  Write-Output "Registration check completed without changing installed packages."
  Write-Output "Details were saved under: $logDir"
  exit 0
}

if ($beforeState.PackageInstalled) {
  Write-Section "Stop Existing Processes"
  Stop-TargetProcesses -State $beforeState

  Write-Section "Remove Current-User Package"
  Write-Output "Removing current-user package: $($beforeState.PackageFullName)"
  Remove-AppxPackage -Package $beforeState.PackageFullName
} else {
  Write-Section "Remove Current-User Package"
  Write-Output "No current-user package was installed."
}

$afterRemoveState = Wait-ForCurrentUserRemoval
Write-Section "After Remove"
Write-StateSummary -State $afterRemoveState

$failures = New-Object 'System.Collections.Generic.List[string]'
if ($afterRemoveState.PackageInstalled) {
  $failures.Add("Current-user package is still installed: $($afterRemoveState.PackageFullName).") | Out-Null
}
if ($afterRemoveState.SoapyStartApps.Count -gt 0) {
  $failures.Add("Soapy Start entries still exist after removal: $(Format-StartApps $afterRemoveState.SoapyStartApps)") | Out-Null
}

if ($failures.Count -eq 0 -and $resolvedPackagePath) {
  Write-Section "Install Provided Package"
  Write-Output "Installing package for current user: $resolvedPackagePath"
  Add-AppxPackage -Path $resolvedPackagePath
  Start-Sleep -Seconds 2

  $afterInstallState = Get-RegistrationState -Label "after-install"
  Write-Section "After Install"
  Write-StateSummary -State $afterInstallState

  if (-not $afterInstallState.PackageInstalled) {
    $failures.Add("Package was not installed after Add-AppxPackage.") | Out-Null
  }
  if ($afterInstallState.Version -ne $expectedAppxVersion) {
    $failures.Add("Installed package version is '$($afterInstallState.Version)', expected '$expectedAppxVersion'.") | Out-Null
  }
  if ($afterInstallState.PackageFamilyName -ne $expectedPackageFamilyName) {
    $failures.Add("Installed PackageFamilyName is '$($afterInstallState.PackageFamilyName)', expected '$expectedPackageFamilyName'.") | Out-Null
  }
  if ($afterInstallState.SignatureKind -ne $expectedSignatureKind) {
    $failures.Add("Installed SignatureKind is '$($afterInstallState.SignatureKind)', expected '$expectedSignatureKind'.") | Out-Null
  }
  if ($afterInstallState.MatchingStartApps.Count -eq 0) {
    $failures.Add("Expected AUMID was not registered after install: $expectedAumid.") | Out-Null
  }

  $packageSummary = Get-SoapyManifestSummaryFromPackagePath -PackagePath $resolvedPackagePath -ApplicationId $AppId
  if ($afterInstallState.ManifestSummary) {
    foreach ($difference in Compare-SoapyManifestSummaryCore -Expected $packageSummary -Actual $afterInstallState.ManifestSummary) {
      $failures.Add("Installed manifest differs from provided package: $difference") | Out-Null
    }
  }
}

Save-RecentEvents -Since $operationStart

Write-Section "Result"
if ($failures.Count -gt 0) {
  foreach ($failure in $failures) {
    Write-Output "FAIL: $failure"
  }
  Write-Output "Details were saved under: $logDir"
  exit 1
}

if ($resolvedPackagePath) {
  Write-Output "Current-user Store registration was reset and the provided package was installed."
  Write-Output "Next step: npm run store:activation-smoke"
} else {
  Write-Output "Current-user Store registration was reset."
  Write-Output "Next step: reinstall Soapy Panels from the intended Store/test-flight package, then run npm run store:activation-smoke."
}
Write-Output "Details were saved under: $logDir"

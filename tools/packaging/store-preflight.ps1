param(
  [string]$Repo = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($Repo)) {
  $scriptBasedRepo = $null

  if ($PSScriptRoot) {
    try {
      $candidate = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
      if (Test-Path -LiteralPath (Join-Path $candidate "package.json") -PathType Leaf) {
        $scriptBasedRepo = $candidate
      }
    } catch {}
  }

  if ($scriptBasedRepo) {
    $Repo = $scriptBasedRepo
  } elseif (Test-Path -LiteralPath (Join-Path (Get-Location).Path "package.json") -PathType Leaf) {
    $Repo = (Get-Location).Path
  } else {
    throw "Unable to locate the repository. Pass its path with -Repo."
  }
}

$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$Problems = New-Object 'System.Collections.Generic.List[object]'
$Warnings = New-Object 'System.Collections.Generic.List[string]'
$Actions  = New-Object 'System.Collections.Generic.List[string]'
$StepResults = New-Object 'System.Collections.Generic.List[object]'

$LogDir = $null
$TranscriptStarted = $false
$TranscriptFile = $null
$FinalUpload = $null

function Write-Section {
  param([string]$Text)
  Write-Host ""
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Write-Status {
  param(
    [string]$Label,
    [string]$Text,
    [System.ConsoleColor]$Color = [System.ConsoleColor]::White
  )
  Write-Host ("[{0}] {1}" -f $Label, $Text) -ForegroundColor $Color
}

function Add-WarningMsg {
  param([string]$Message)
  $Warnings.Add($Message) | Out-Null
  Write-Status "WARN" $Message Yellow
}

function Add-ManualFailure {
  param(
    [string]$StepName,
    [string]$Message,
    [string]$Reason,
    [int]$ExitCode = 1,
    [string]$LastOutput = ""
  )

  $Result = [pscustomobject]@{
    Step = $StepName
    Success = $false
    ExitCode = $ExitCode
    Message = $Message
    Reason = $Reason
    LogFile = ""
    LastOutput = $LastOutput
  }

  $StepResults.Add($Result) | Out-Null
  $Problems.Add($Result) | Out-Null

  Write-Status "FAIL" "$StepName - $Message" Red
}

function Get-FriendlyErrorReason {
  param(
    [string]$StepName,
    [string]$Text
  )

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return "The command failed, but it did not print a useful error message. Check whether it crashed immediately, opened another process, or wrote its details to a separate tool log."
  }

  switch -Regex ($Text) {
    "ERESOLVE|unable to resolve dependency tree|peer dep|Conflicting peer dependency" {
      return "npm dependency conflict. Usually package.json and package-lock.json disagree, or one package requires a different version of another package."
    }
    "EACCES|EPERM|permission denied|operation not permitted|access is denied|Access is denied" {
      return "Permission or locked-file problem. A file may be in use, PowerShell may not have permission, antivirus may be blocking it, or node_modules may contain locked files."
    }
    "ENOENT|no such file or directory|cannot find the path|path does not exist|The system cannot find the file specified" {
      return "Missing file or path. The command expected a file/folder that does not exist, or the script is running from the wrong folder."
    }
    "ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network|proxy|certificate|SELF_SIGNED_CERT|unable to get local issuer certificate|ECONNREFUSED" {
      return "Network, proxy, or certificate problem. npm or the build tool could not download something correctly."
    }
    "node-gyp|gyp ERR|MSBuild|Visual Studio Build Tools|cl.exe|python|Could not find any Visual Studio installation" {
      return "Native module build problem. A dependency needs build tools such as Python, MSBuild, or Visual Studio Build Tools."
    }
    "ENOSPC|no space left|disk full|There is not enough space" {
      return "Disk space problem. The drive may not have enough free space."
    }
    "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" {
      return "Missing Node dependency or bad import. Running npm install may fix it, unless package.json/package-lock.json are wrong."
    }
    "electron-builder|Invalid configuration|configuration.*invalid|Unknown target|Cannot compute electron version" {
      return "Electron Builder configuration problem. Check packaging/electron-builder.json and the package.json build/package scripts."
    }
    "SignTool Error|signtool|certificate|No certificates were found|No certificates were found that met all the given criteria" {
      return "Signing problem. The package could not be signed, or the expected signing certificate was not found."
    }
    "makeappx|manifest validation|AppxManifest|MSIX|APPX|error C00CE|Package acceptance validation error" {
      return "MSIX/AppX packaging problem. The app manifest, package identity, assets, or Store packaging step may be invalid."
    }
    "Publisher|Package/Identity|CN=|identity|manifest publisher|PackageFamilyName" {
      return "Microsoft Store identity problem. The package identity, publisher, package name, or version may not match the Microsoft Store listing."
    }
    default {
      return "The command failed. The most useful details are probably in the last lines of the command output shown below."
    }
  }
}

function Invoke-LoggedStep {
  param(
    [string]$StepName,
    [scriptblock]$Command,
    [switch]$IsNpm
  )

  if (-not $LogDir) {
    $LogDir = Join-Path $Repo "preflight-logs\$RunId"
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  }

  $SafeName = $StepName -replace '[^a-zA-Z0-9_-]', '_'
  $StepLogFile = Join-Path $LogDir "$SafeName.log"

  Write-Host ""
  Write-Host "=== Running: $StepName ===" -ForegroundColor Cyan
  Write-Host "Log: $StepLogFile" -ForegroundColor DarkGray

  $ExitCode = 0

  try {
    & $Command 2>&1 | Tee-Object -FilePath $StepLogFile
    $ExitCode = $LASTEXITCODE

    if ($null -eq $ExitCode) {
      if ($?) {
        $ExitCode = 0
      } else {
        $ExitCode = 1
      }
    }
  } catch {
    $ExitCode = 1
    $_ | Out-String | Tee-Object -FilePath $StepLogFile -Append
  }

  if ($IsNpm -and $ExitCode -ne 0) {
    try {
      $NpmCache = npm config get cache 2>$null
      $NpmLogFolder = Join-Path $NpmCache "_logs"

      if (Test-Path -LiteralPath $NpmLogFolder -PathType Container) {
        $LatestNpmLog = Get-ChildItem -LiteralPath $NpmLogFolder -Filter "*.log" -File |
          Sort-Object LastWriteTime -Descending |
          Select-Object -First 1

        if ($LatestNpmLog) {
          Add-Content -LiteralPath $StepLogFile -Value ""
          Add-Content -LiteralPath $StepLogFile -Value "=== Latest npm internal debug log ==="
          Add-Content -LiteralPath $StepLogFile -Value $LatestNpmLog.FullName
          Add-Content -LiteralPath $StepLogFile -Value ""
          Add-Content -LiteralPath $StepLogFile -Value "=== Last 160 lines from npm internal debug log ==="
          Get-Content -LiteralPath $LatestNpmLog.FullName -Tail 160 | Add-Content -LiteralPath $StepLogFile
        }
      }
    } catch {
      Add-Content -LiteralPath $StepLogFile -Value ""
      Add-Content -LiteralPath $StepLogFile -Value "Could not read npm internal debug log."
    }
  }

  $RawText = ""
  if (Test-Path -LiteralPath $StepLogFile -PathType Leaf) {
    $RawText = Get-Content -LiteralPath $StepLogFile -Raw -ErrorAction SilentlyContinue
  }

  $TailText = ""
  if (Test-Path -LiteralPath $StepLogFile -PathType Leaf) {
    $TailText = (Get-Content -LiteralPath $StepLogFile -Tail 100 -ErrorAction SilentlyContinue) -join "`n"
  }

  $Success = ($ExitCode -eq 0)
  $Reason = if ($Success) { "No error." } else { Get-FriendlyErrorReason -StepName $StepName -Text $RawText }

  $Result = [pscustomobject]@{
    Step = $StepName
    Success = $Success
    ExitCode = $ExitCode
    Message = if ($Success) { "$StepName completed successfully." } else { "$StepName failed with exit code $ExitCode." }
    Reason = $Reason
    LogFile = $StepLogFile
    LastOutput = $TailText
  }

  $StepResults.Add($Result) | Out-Null

  if ($Success) {
    Write-Status "OK" "$StepName completed successfully." Green
  } else {
    $Problems.Add($Result) | Out-Null
    Write-Status "FAIL" "$StepName failed with exit code $ExitCode." Red
    Write-Host "Likely reason: $Reason" -ForegroundColor Yellow
  }

  return $Result
}

function Show-FinalReport {
  param([int]$ExitCode = 0)

  Write-Host ""
  Write-Host "=== Final Result ===" -ForegroundColor Cyan

  $FailedSteps = @($StepResults | Where-Object { -not $_.Success })

  if ($FailedSteps.Count -eq 0) {
    Write-Host "Did it encounter terminal errors? NO" -ForegroundColor Green
    Write-Host "Result: SUCCESS" -ForegroundColor Green
  } else {
    Write-Host "Did it encounter terminal errors? YES" -ForegroundColor Red
    Write-Host "Result: FAILED" -ForegroundColor Red

    foreach ($Step in $FailedSteps) {
      Write-Host ""
      Write-Host "Failed step:" -ForegroundColor Red
      Write-Host "  $($Step.Step)" -ForegroundColor Red

      Write-Host ""
      Write-Host "Exit code:" -ForegroundColor Red
      Write-Host "  $($Step.ExitCode)" -ForegroundColor Red

      if ($Step.Message) {
        Write-Host ""
        Write-Host "Error:" -ForegroundColor Red
        Write-Host "  $($Step.Message)" -ForegroundColor Red
      }

      Write-Host ""
      Write-Host "What the error probably means:" -ForegroundColor Yellow
      Write-Host "  $($Step.Reason)" -ForegroundColor Yellow

      if ($Step.LogFile) {
        Write-Host ""
        Write-Host "Detailed log:" -ForegroundColor Cyan
        Write-Host "  $($Step.LogFile)" -ForegroundColor Cyan
      }

      if ($Step.LastOutput) {
        Write-Host ""
        Write-Host "Last useful output from that step:" -ForegroundColor Cyan
        Write-Host $Step.LastOutput
      }
    }
  }

  if ($Warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "Warnings:" -ForegroundColor Yellow
    foreach ($w in $Warnings) {
      Write-Host " - $w" -ForegroundColor Yellow
    }
  }

  if ($Actions.Count -gt 0) {
    Write-Host ""
    Write-Host "Actions / decisions:" -ForegroundColor Cyan
    foreach ($a in $Actions) {
      Write-Host " - $a"
    }
  }

  if ($FinalUpload) {
    Write-Host ""
    Write-Host "Store upload package:" -ForegroundColor Green
    Write-Host $FinalUpload.FullName -ForegroundColor Green
  }

  if ($LogDir) {
    Write-Host ""
    Write-Host "Step logs folder:" -ForegroundColor Cyan
    Write-Host $LogDir -ForegroundColor Cyan
  }

  if ($TranscriptFile) {
    Write-Host ""
    Write-Host "Full terminal transcript:" -ForegroundColor Cyan
    Write-Host $TranscriptFile -ForegroundColor Cyan
  }

  if ($TranscriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
    $script:TranscriptStarted = $false
  }

  [Environment]::ExitCode = $ExitCode
}

function Stop-WithReport {
  param([int]$Code = 1)
  Show-FinalReport -ExitCode $Code
  return
}

function Find-WindowsSdkTool {
  param([string]$ToolName)

  $cmd = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $roots = @()

  $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $pf = [Environment]::GetEnvironmentVariable("ProgramFiles")

  if ($pf86) { $roots += (Join-Path $pf86 "Windows Kits\10\bin") }
  if ($pf)   { $roots += (Join-Path $pf   "Windows Kits\10\bin") }

  foreach ($root in ($roots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
      continue
    }

    $versions = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending

    foreach ($v in $versions) {
      foreach ($arch in @("x64", "x86", "arm64")) {
        $candidate = Join-Path $v.FullName (Join-Path $arch $ToolName)
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
          return $candidate
        }
      }
    }
  }

  return $null
}

function Test-VersionCommand {
  param(
    [string]$DisplayName,
    [string]$CommandName,
    [string[]]$CommandArgs,
    [string]$MissingExplanation
  )

  $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Add-ManualFailure `
      -StepName "Tool check: $DisplayName" `
      -Message "$CommandName was not found on PATH." `
      -Reason $MissingExplanation
    return $false
  }

  $output = & $CommandName @CommandArgs 2>&1
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }

  if ($code -ne 0) {
    Add-ManualFailure `
      -StepName "Tool check: $DisplayName" `
      -Message "$CommandName exists, but failed with exit code $code." `
      -Reason $MissingExplanation `
      -ExitCode $code `
      -LastOutput (($output | Out-String).Trim())
    return $false
  }

  $firstLine = (($output | Select-Object -First 1) -join "").Trim()
  if ([string]::IsNullOrWhiteSpace($firstLine)) {
    $firstLine = "available"
  }

  Write-Status "OK" "$DisplayName $firstLine" Green
  return $true
}

function Get-CurrentPowerShellExe {
  $currentPowerShell = $null

  try {
    $currentPowerShell = (Get-Process -Id $PID).Path
  } catch {}

  if ($currentPowerShell -and (Test-Path -LiteralPath $currentPowerShell -PathType Leaf)) {
    return $currentPowerShell
  }

  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) { return $pwsh.Source }

  $powershell = Get-Command powershell -ErrorAction SilentlyContinue
  if ($powershell) { return $powershell.Source }

  return $null
}

function Get-LatestUploadPackage {
  $searchRoots = @(".\out\make", ".\dist") | Where-Object {
    Test-Path -LiteralPath $_ -PathType Container
  }

  if (-not $searchRoots -or $searchRoots.Count -eq 0) {
    return $null
  }

  return Get-ChildItem -Path $searchRoots -Recurse -Include "*.appxupload","*.msixupload" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Get-LatestRelevantInput {
  $inputPaths = @(
    "package.json",
    "package-lock.json",
    "packaging",
    "tools\packaging",
    "src",
    "public",
    "assets",
    "resources",
    "build",
    "electron",
    "main.js",
    "preload.js",
    "index.html",
    "vite.config.*",
    "electron.vite.config.*",
    "tsconfig*.json"
  )

  $latest = $null

  foreach ($path in $inputPaths) {
    $items = Get-ChildItem -Path $path -Recurse -File -Force -ErrorAction SilentlyContinue
    foreach ($item in $items) {
      if ($null -eq $latest -or $item.LastWriteTime -gt $latest.LastWriteTime) {
        $latest = $item
      }
    }
  }

  return $latest
}

Write-Section "Soapy Panels Store Package Preflight"

if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
  Add-ManualFailure `
    -StepName "Repo folder check" `
    -Message "The repo folder does not exist: $Repo" `
    -Reason "The path is wrong, the folder was moved, or the repository has not been cloned/restored."
  Stop-WithReport 1
  return
}

Set-Location -LiteralPath $Repo

$LogDir = Join-Path $Repo "preflight-logs\$RunId"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$TranscriptFile = Join-Path $LogDir "full-terminal-transcript.log"

try {
  Start-Transcript -Path $TranscriptFile -Force | Out-Null
  $TranscriptStarted = $true
  Write-Status "LOG" "Saving full terminal transcript to: $TranscriptFile" DarkGray
} catch {
  Add-WarningMsg "Could not start transcript log. The script will continue, but no full transcript may be saved."
}

Write-Status "OK" "Using repo: $Repo" Green

Write-Section "Required Repo Files"

$requiredItems = @(
  @{ Path = "package.json"; Kind = "File"; Why = "needed for npm scripts" },
  @{ Path = "packaging\electron-builder.json"; Kind = "File"; Why = "needed for Electron Builder Store config" },
  @{ Path = "packaging\assets"; Kind = "Folder"; Why = "needed for app/store assets" },
  @{ Path = "packaging\assets\icon.png"; Kind = "File"; Why = "needed for app icon generation" },
  @{ Path = "tools\packaging\build-store-upload.ps1"; Kind = "File"; Why = "needed by the Store package pipeline" },
  @{ Path = "tools\packaging\generate-msix-assets.ps1"; Kind = "File"; Why = "needed to generate MSIX assets" },
  @{ Path = "tools\packaging\verify-msix-identity.ps1"; Kind = "File"; Why = "needed to verify Store identity" },
  @{ Path = "tools\packaging\make-msixupload.ps1"; Kind = "File"; Why = "needed to create the upload package" }
)

foreach ($item in $requiredItems) {
  if ($item.Kind -eq "Folder") {
    $exists = Test-Path -LiteralPath $item.Path -PathType Container
  } else {
    $exists = Test-Path -LiteralPath $item.Path -PathType Leaf
  }

  if ($exists) {
    Write-Status "OK" "$($item.Path)" Green
  } else {
    Add-ManualFailure `
      -StepName "Required repo files" `
      -Message "Missing $($item.Kind.ToLower()): $($item.Path)" `
      -Reason "This file/folder is required because it is $($item.Why). Restore it from git or switch to the correct branch."
  }
}

if (($StepResults | Where-Object { -not $_.Success }).Count -gt 0) {
  Stop-WithReport 1
  return
}

Write-Section "package.json Check"

try {
  $packageJson = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
} catch {
  Add-ManualFailure `
    -StepName "package.json check" `
    -Message "Could not read or parse package.json." `
    -Reason "package.json may contain invalid JSON. Fix the JSON formatting before running npm commands." `
    -LastOutput ($_.Exception.Message)
  Stop-WithReport 1
  return
}

$storeScript = $null
if ($packageJson.scripts -and ($packageJson.scripts.PSObject.Properties.Name -contains "store:package")) {
  $storeScript = $packageJson.scripts.'store:package'
}

if ([string]::IsNullOrWhiteSpace($storeScript)) {
  Add-ManualFailure `
    -StepName "package.json check" `
    -Message "The npm script store:package was not found." `
    -Reason "The command npm run store:package cannot work until package.json contains a scripts entry named store:package."
  Stop-WithReport 1
  return
}

Write-Status "OK" "Found npm script: store:package = $storeScript" Green

Write-Section "Tool Checks"

Test-VersionCommand `
  -DisplayName "Node.js" `
  -CommandName "node" `
  -CommandArgs @("--version") `
  -MissingExplanation "Install Node.js, then close and reopen PowerShell so PATH updates." | Out-Null

Test-VersionCommand `
  -DisplayName "npm" `
  -CommandName "npm" `
  -CommandArgs @("--version") `
  -MissingExplanation "npm normally comes with Node.js. Reinstall Node.js or fix PATH if npm is missing." | Out-Null

$dotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnetCmd) {
  Add-ManualFailure `
    -StepName "Tool check: .NET SDK" `
    -Message "dotnet was not found on PATH." `
    -Reason "Install the .NET SDK, not only the runtime. Then close and reopen PowerShell."
} else {
  $dotnetSdks = & dotnet --list-sdks 2>&1
  $dotnetCode = $LASTEXITCODE

  if ($dotnetCode -ne 0 -or -not $dotnetSdks) {
    Add-ManualFailure `
      -StepName "Tool check: .NET SDK" `
      -Message "dotnet exists, but no .NET SDK was detected." `
      -Reason "store-bridge:build needs the .NET SDK. Install the SDK version, not just the runtime." `
      -ExitCode $dotnetCode `
      -LastOutput (($dotnetSdks | Out-String).Trim())
  } else {
    $firstSdk = ($dotnetSdks | Select-Object -First 1).ToString()
    Write-Status "OK" ".NET SDK detected: $firstSdk" Green
  }
}

$signtool = Find-WindowsSdkTool "signtool.exe"
if ($signtool) {
  Write-Status "OK" "signtool.exe found: $signtool" Green
} else {
  Add-ManualFailure `
    -StepName "Tool check: Windows SDK signtool.exe" `
    -Message "signtool.exe was not found." `
    -Reason "Install Windows SDK / Windows App SDK packaging tools. Signing or packaging may fail without signtool.exe."
}

$makeappx = Find-WindowsSdkTool "makeappx.exe"
if ($makeappx) {
  Write-Status "OK" "makeappx.exe found: $makeappx" Green
} else {
  Add-ManualFailure `
    -StepName "Tool check: Windows SDK makeappx.exe" `
    -Message "makeappx.exe was not found." `
    -Reason "Install Windows SDK / Windows App SDK packaging tools. Creating AppX/MSIX packages may fail without makeappx.exe."
}

if (($StepResults | Where-Object { -not $_.Success }).Count -gt 0) {
  Stop-WithReport 1
  return
}

Write-Section "npm Dependency Check"

$needInstall = $false
$installReason = ""

if (-not (Test-Path -LiteralPath "node_modules" -PathType Container)) {
  $needInstall = $true
  $installReason = "node_modules is missing"
  Write-Status "NEED" "npm install is needed because node_modules is missing." Yellow
} elseif (-not (Test-Path -LiteralPath "node_modules\.package-lock.json" -PathType Leaf)) {
  $needInstall = $true
  $installReason = "node_modules exists, but npm's node_modules lock file is missing"
  Write-Status "NEED" "npm install is recommended because node_modules may be incomplete." Yellow
} elseif (Test-Path -LiteralPath "package-lock.json" -PathType Leaf) {
  $nodeModulesTime = (Get-Item -LiteralPath "node_modules").LastWriteTime
  $packageLockTime = (Get-Item -LiteralPath "package-lock.json").LastWriteTime
  $packageJsonTime = (Get-Item -LiteralPath "package.json").LastWriteTime

  if ($packageLockTime -gt $nodeModulesTime -or $packageJsonTime -gt $nodeModulesTime) {
    $needInstall = $true
    $installReason = "package.json or package-lock.json is newer than node_modules"
    Write-Status "NEED" "npm install is needed because package files are newer than node_modules." Yellow
  } else {
    Write-Status "OK" "node_modules looks current enough." Green
    $Actions.Add("Skipped npm install because node_modules exists and package files are not newer.") | Out-Null
  }
} else {
  $needInstall = $true
  $installReason = "package-lock.json is missing"
  Write-Status "NEED" "npm install is needed because package-lock.json is missing." Yellow
}

if ($needInstall) {
  $Actions.Add("Ran npm install because $installReason.") | Out-Null

  $npmResult = Invoke-LoggedStep -StepName "npm install" -IsNpm -Command {
    npm install --foreground-scripts --loglevel verbose
  }

  if (-not $npmResult.Success) {
    Stop-WithReport $npmResult.ExitCode
    return
  }
}

Write-Section "Store Package Check"

$latestUpload = Get-LatestUploadPackage
$latestInput = Get-LatestRelevantInput
$needPackage = $true
$packageReason = ""

if ($latestUpload) {
  Write-Status "OK" "Found existing upload package: $($latestUpload.FullName)" Green

  if ($latestInput -and $latestInput.LastWriteTime -gt $latestUpload.LastWriteTime) {
    $needPackage = $true
    $packageReason = "a project/package input changed after the existing upload package was created: $($latestInput.FullName)"
    Write-Status "NEED" "Rebuild needed because a relevant input is newer than the existing upload package." Yellow
    Write-Host "Newest input: $($latestInput.FullName)"
    Write-Host "Existing package: $($latestUpload.FullName)"
  } else {
    $pwshExe = Get-CurrentPowerShellExe

    if (-not $pwshExe) {
      Add-ManualFailure `
        -StepName "Existing package verification" `
        -Message "Could not find a usable PowerShell executable." `
        -Reason "PowerShell itself could not be located from this session. Restart PowerShell and try again."
      Stop-WithReport 1
      return
    }

    $verifyResult = Invoke-LoggedStep -StepName "verify existing upload package" -Command {
      & $pwshExe -NoProfile -ExecutionPolicy Bypass -File ".\tools\packaging\verify-msix-identity.ps1" -MsixPath $latestUpload.FullName
    }

    if ($verifyResult.Success) {
      Write-Host ""
      Write-Host "Existing upload package verified successfully. No rebuild needed." -ForegroundColor Green
      $needPackage = $false
      $FinalUpload = $latestUpload
      $Actions.Add("Skipped npm run store:package because an existing upload package was found and verified.") | Out-Null
    } else {
      Write-Host ""
      Write-Host "Existing upload package failed verification. Rebuild is needed." -ForegroundColor Yellow
      $needPackage = $true
      $packageReason = "the existing upload package failed verification"
    }
  }
} else {
  $needPackage = $true
  $packageReason = "no existing .appxupload or .msixupload package was found"
  Write-Status "NEED" "Build needed because no upload package was found." Yellow
}

if ($needPackage) {
  $Actions.Add("Ran npm run store:package because $packageReason.") | Out-Null

  $packageResult = Invoke-LoggedStep -StepName "npm run store:package" -IsNpm -Command {
    npm run store:package
  }

  if (-not $packageResult.Success) {
    Stop-WithReport $packageResult.ExitCode
    return
  }
}

Write-Section "Final Package Check"

$FinalUpload = Get-LatestUploadPackage

if (-not $FinalUpload) {
  Add-ManualFailure `
    -StepName "Final package check" `
    -Message "No .appxupload or .msixupload package was found after the check/build." `
    -Reason "The build may have completed without creating a Store upload package, or it may be outputting to a different folder than .\out\make or .\dist." `
    -LastOutput "Checked .\out\make and .\dist but no upload package was found."

  Stop-WithReport 1
  return
}

Write-Status "OK" "Store upload package found: $($FinalUpload.FullName)" Green

$pwshExe = Get-CurrentPowerShellExe

if (-not $pwshExe) {
  Add-ManualFailure `
    -StepName "Final package verification" `
    -Message "Could not find a usable PowerShell executable." `
    -Reason "PowerShell itself could not be located from this session. Restart PowerShell and try again."
  Stop-WithReport 1
  return
}

$finalVerifyResult = Invoke-LoggedStep -StepName "verify final upload package" -Command {
  & $pwshExe -NoProfile -ExecutionPolicy Bypass -File ".\tools\packaging\verify-msix-identity.ps1" -MsixPath $FinalUpload.FullName
}

if (-not $finalVerifyResult.Success) {
  Stop-WithReport $finalVerifyResult.ExitCode
  return
}

Show-FinalReport -ExitCode 0
return

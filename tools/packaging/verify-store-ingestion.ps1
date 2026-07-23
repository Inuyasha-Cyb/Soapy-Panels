param(
  [string]$ProvenancePath,
  [string]$ReportPath,
  [switch]$SkipInstalledCheck
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop

if ($PSVersionTable.PSEdition -eq "Core" -and -not $SkipInstalledCheck) {
  throw "Run this script with Windows PowerShell, not PowerShell Core, so Get-AppxPackage/Get-StartApps are available."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "store-package-helpers.ps1")

if (-not $ProvenancePath) {
  $ProvenancePath = $SoapyDefaultProvenancePath
}
if (-not [System.IO.Path]::IsPathRooted($ProvenancePath)) {
  $ProvenancePath = Join-Path $root $ProvenancePath
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $root "out\make\store-ingestion-check.json"
}
if (-not [System.IO.Path]::IsPathRooted($ReportPath)) {
  $ReportPath = Join-Path $root $ReportPath
}

$builderConfig = Get-SoapyBuilderAppxConfig
$expectedIdentityName = [string]$builderConfig.identityName
$expectedApplicationId = [string]$builderConfig.applicationId
$expectedPublisher = [string]$builderConfig.publisher
$expectedPublisherDisplayName = [string]$builderConfig.publisherDisplayName
$expectedDisplayName = [string]$builderConfig.displayName
$expectedMinVersion = [string]$builderConfig.minVersion
$expectedAppxVersion = Get-SoapyExpectedAppxVersion
$expectedPackageFamilyName = Get-SoapyExpectedPackageFamilyName
$expectedSignatureKind = Get-SoapyExpectedSignatureKind
$expectedAumid = Get-SoapyExpectedAumid -ApplicationId $expectedApplicationId
$expectedExecutable = "app\SoapyPanels.exe"
$expectedRuntimeBehavior = "packagedClassicApp"
$expectedTrustLevel = "mediumIL"

$failures = New-Object 'System.Collections.Generic.List[string]'
$warnings = New-Object 'System.Collections.Generic.List[string]'

function Write-Section {
  param([string]$Text)
  Write-Output ""
  Write-Output "=== $Text ==="
}

function Add-Failure {
  param([string]$Message)
  $failures.Add($Message) | Out-Null
}

function Add-Warning {
  param([string]$Message)
  $warnings.Add($Message) | Out-Null
}

function Compare-FourPartVersion {
  param(
    [string]$Left,
    [string]$Right
  )

  $leftVersion = [version]$Left
  $rightVersion = [version]$Right
  return $leftVersion.CompareTo($rightVersion)
}

function Get-AuthenticodeSummary {
  param([string]$Path)

  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
    return [pscustomobject][ordered]@{
      Status = [string]$signature.Status
      StatusMessage = [string]$signature.StatusMessage
      SignerCertificateSubject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "" }
    }
  } catch {
    return [pscustomobject][ordered]@{
      Status = "Unavailable"
      StatusMessage = $_.Exception.Message
      SignerCertificateSubject = ""
    }
  }
}

function Get-FileFingerprint {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "File was not found: $Path"
  }

  $item = Get-Item -LiteralPath $Path
  $sha256 = Get-SoapyFileSha256 -Path $item.FullName

  return [pscustomobject][ordered]@{
    Path = $item.FullName
    Name = $item.Name
    Length = $item.Length
    LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString("o")
    Sha256 = $sha256
    Authenticode = Get-AuthenticodeSummary -Path $item.FullName
  }
}

function Get-SoapyFileSha256 {
  param([string]$Path)

  $getFileHash = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($getFileHash) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace "-", "").ToUpperInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-PackageInspection {
  param([string]$PackagePath)

  if (-not [System.IO.Path]::IsPathRooted($PackagePath)) {
    $PackagePath = Join-Path $root $PackagePath
  }
  if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
    throw "Store package path was not found: $PackagePath"
  }

  $packageItem = Get-Item -LiteralPath $PackagePath
  $extension = $packageItem.Extension.ToLowerInvariant()
  $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("soapy-store-ingestion-" + [System.Guid]::NewGuid().ToString("N"))
  $innerFingerprint = $null
  $innerPackageName = ""

  try {
    if ($extension -in @(".appxupload", ".msixupload")) {
      Expand-SoapyPackageArchive -PackagePath $packageItem.FullName -WorkDir $workDir
      $innerPackage = Get-ChildItem -LiteralPath $workDir -Recurse -File |
        Where-Object { $_.Extension -in ".appx",".msix" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

      if (-not $innerPackage) {
        throw "Upload package did not contain an inner AppX/MSIX package: $($packageItem.FullName)"
      }

      $innerPackageName = $innerPackage.Name
      $innerFingerprint = Get-FileFingerprint -Path $innerPackage.FullName
    } else {
      $innerPackageName = $packageItem.Name
      $innerFingerprint = Get-FileFingerprint -Path $packageItem.FullName
    }

    return [pscustomobject][ordered]@{
      UploadFingerprint = Get-FileFingerprint -Path $packageItem.FullName
      InnerPackageName = $innerPackageName
      InnerPackageFingerprint = $innerFingerprint
      ManifestSummary = Get-SoapyManifestSummaryFromPackagePath -PackagePath $packageItem.FullName -ApplicationId $expectedApplicationId
    }
  } finally {
    if (Test-Path -LiteralPath $workDir) {
      Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Test-ManifestSummaryAgainstExpected {
  param(
    $Summary,
    [string]$Label
  )

  if (-not $Summary) {
    Add-Failure "$Label manifest summary is missing."
    return
  }

  if ([string]$Summary.IdentityName -ne $expectedIdentityName) {
    Add-Failure "$Label IdentityName is '$($Summary.IdentityName)', expected '$expectedIdentityName'."
  }
  if ([string]$Summary.IdentityPublisher -ne $expectedPublisher) {
    Add-Failure "$Label IdentityPublisher is '$($Summary.IdentityPublisher)', expected '$expectedPublisher'."
  }
  if ([string]$Summary.IdentityVersion -ne $expectedAppxVersion) {
    Add-Failure "$Label IdentityVersion is '$($Summary.IdentityVersion)', expected '$expectedAppxVersion'."
  }
  if ([string]$Summary.DisplayName -ne $expectedDisplayName) {
    Add-Failure "$Label DisplayName is '$($Summary.DisplayName)', expected '$expectedDisplayName'."
  }
  if ([string]$Summary.PublisherDisplayName -ne $expectedPublisherDisplayName) {
    Add-Failure "$Label PublisherDisplayName is '$($Summary.PublisherDisplayName)', expected '$expectedPublisherDisplayName'."
  }
  if ([string]$Summary.TargetDeviceFamilyName -ne "Windows.Desktop") {
    Add-Failure "$Label TargetDeviceFamilyName is '$($Summary.TargetDeviceFamilyName)', expected 'Windows.Desktop'."
  }
  if ([string]$Summary.TargetDeviceFamilyMinVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    Add-Failure "$Label TargetDeviceFamilyMinVersion must use four-part version format, found '$($Summary.TargetDeviceFamilyMinVersion)'."
  } elseif ((Compare-FourPartVersion ([string]$Summary.TargetDeviceFamilyMinVersion) $expectedMinVersion) -lt 0) {
    Add-Failure "$Label TargetDeviceFamilyMinVersion is '$($Summary.TargetDeviceFamilyMinVersion)', expected at least '$expectedMinVersion'."
  }
  if ([string]$Summary.ApplicationId -ne $expectedApplicationId) {
    Add-Failure "$Label ApplicationId is '$($Summary.ApplicationId)', expected '$expectedApplicationId'."
  }
  if ([string]$Summary.ApplicationExecutable -ne $expectedExecutable) {
    Add-Failure "$Label ApplicationExecutable is '$($Summary.ApplicationExecutable)', expected '$expectedExecutable'."
  }
  if ([string]$Summary.ApplicationEntryPoint) {
    Add-Failure "$Label ApplicationEntryPoint must be empty, found '$($Summary.ApplicationEntryPoint)'."
  }
  if ([string]$Summary.ApplicationRuntimeBehavior -ne $expectedRuntimeBehavior) {
    Add-Failure "$Label ApplicationRuntimeBehavior is '$($Summary.ApplicationRuntimeBehavior)', expected '$expectedRuntimeBehavior'."
  }
  if ([string]$Summary.ApplicationTrustLevel -ne $expectedTrustLevel) {
    Add-Failure "$Label ApplicationTrustLevel is '$($Summary.ApplicationTrustLevel)', expected '$expectedTrustLevel'."
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

function Get-InstalledStoreReport {
  param($ExpectedPackageSummary)

  $pkg = Get-AppxPackage -Name $expectedIdentityName |
    Sort-Object Version -Descending |
    Select-Object -First 1

  if (-not $pkg) {
    Add-Warning "Store package '$expectedIdentityName' is not installed for the current user. Install the intended Store/test-flight package and rerun ingestion check."
    return [pscustomobject][ordered]@{
      Present = $false
      ExpectedPackageFamilyName = $expectedPackageFamilyName
      ExpectedSignatureKind = $expectedSignatureKind
      ExpectedAUMID = $expectedAumid
    }
  }

  $manifestPath = Join-Path $pkg.InstallLocation "AppxManifest.xml"
  $installedManifestSummary = $null
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $installedManifestSummary = Get-SoapyManifestSummaryFromManifestPath -ManifestPath $manifestPath -ApplicationId $expectedApplicationId
    Test-ManifestSummaryAgainstExpected -Summary $installedManifestSummary -Label "Installed package"
    foreach ($difference in Compare-SoapyManifestSummaryCore -Expected $ExpectedPackageSummary -Actual $installedManifestSummary) {
      Add-Failure "Installed manifest differs from latest upload package: $difference"
    }
  } else {
    Add-Failure "Installed AppxManifest.xml was not found at '$manifestPath'."
  }

  $registeredStartApps = @(Get-StartApps -ErrorAction SilentlyContinue)
  $matchingStartApps = @($registeredStartApps | Where-Object { $_.AppID -eq $expectedAumid })
  $soapyStartApps = @(
    $registeredStartApps |
      Where-Object {
        $_.Name -eq $expectedDisplayName -or
        $_.Name -like "*Soapy*" -or
        $_.AppID -like "*Soapy*" -or
        $_.AppID -like "*$expectedPackageFamilyName*" -or
        $_.AppID -like "*$expectedIdentityName*"
      }
  )

  if ([string]$pkg.PackageFamilyName -ne $expectedPackageFamilyName) {
    Add-Failure "Installed PackageFamilyName is '$($pkg.PackageFamilyName)', expected '$expectedPackageFamilyName'."
  }
  if ([string]$pkg.SignatureKind -ne $expectedSignatureKind) {
    Add-Failure "Installed SignatureKind is '$($pkg.SignatureKind)', expected '$expectedSignatureKind'."
  }
  if ([string]$pkg.Version -ne $expectedAppxVersion) {
    Add-Failure "Installed package version is '$($pkg.Version)', expected '$expectedAppxVersion'."
  }
  if ($matchingStartApps.Count -eq 0) {
    Add-Failure "Get-StartApps does not expose expected Store AUMID '$expectedAumid'. Soapy entries: $(Format-StartApps $soapyStartApps)"
  }

  return [pscustomobject][ordered]@{
    Present = $true
    Name = [string]$pkg.Name
    PackageFullName = [string]$pkg.PackageFullName
    PackageFamilyName = [string]$pkg.PackageFamilyName
    ExpectedPackageFamilyName = $expectedPackageFamilyName
    Version = [string]$pkg.Version
    ExpectedVersion = $expectedAppxVersion
    SignatureKind = [string]$pkg.SignatureKind
    ExpectedSignatureKind = $expectedSignatureKind
    Status = [string]$pkg.Status
    InstallLocation = [string]$pkg.InstallLocation
    ManifestPath = $manifestPath
    ManifestSummary = $installedManifestSummary
    ExpectedAUMID = $expectedAumid
    MatchingStartApps = @($matchingStartApps | Select-Object Name, AppID)
    SoapyStartApps = @($soapyStartApps | Select-Object Name, AppID)
  }
}

Write-Section "Expected Store Identity"
Write-Output "IdentityName: $expectedIdentityName"
Write-Output "ApplicationId: $expectedApplicationId"
Write-Output "Expected AppX Version: $expectedAppxVersion"
Write-Output "Expected PackageFamilyName: $expectedPackageFamilyName"
Write-Output "Expected SignatureKind: $expectedSignatureKind"
Write-Output "Expected AUMID: $expectedAumid"

$provenance = $null
$packageInspection = $null
$installedReport = $null

if (-not (Test-Path -LiteralPath $ProvenancePath -PathType Leaf)) {
  Add-Failure "Latest Store package provenance was not found at '$ProvenancePath'. Run npm run store:package before ingestion checking."
} else {
  $provenance = Get-Content -LiteralPath $ProvenancePath -Raw | ConvertFrom-Json
  $packagePath = if ($provenance.UploadPath) { [string]$provenance.UploadPath } else { [string]$provenance.PackagePath }

  Write-Section "Upload Package"
  Write-Output "Provenance: $ProvenancePath"
  Write-Output "Package: $packagePath"

  try {
    $packageInspection = Get-PackageInspection -PackagePath $packagePath
    Write-Output "Upload SHA256: $($packageInspection.UploadFingerprint.Sha256)"
    Write-Output "Inner package: $($packageInspection.InnerPackageName)"
    Write-Output "Inner SHA256: $($packageInspection.InnerPackageFingerprint.Sha256)"

    if ([string]$provenance.ExpectedAppxVersion -ne $expectedAppxVersion) {
      Add-Failure "Provenance ExpectedAppxVersion is '$($provenance.ExpectedAppxVersion)', expected '$expectedAppxVersion'."
    }
    Test-ManifestSummaryAgainstExpected -Summary $packageInspection.ManifestSummary -Label "Latest upload package"
    if ($provenance.ManifestSummary) {
      foreach ($difference in Compare-SoapyManifestSummaryCore -Expected $provenance.ManifestSummary -Actual $packageInspection.ManifestSummary) {
        Add-Failure "Latest upload package differs from provenance: $difference"
      }
    } else {
      Add-Failure "Latest provenance does not contain ManifestSummary."
    }
  } catch {
    Add-Failure $_.Exception.Message
  }
}

if ($packageInspection -and -not $SkipInstalledCheck) {
  Write-Section "Installed Store Package"
  $installedReport = Get-InstalledStoreReport -ExpectedPackageSummary $packageInspection.ManifestSummary
  if ($installedReport.Present) {
    Write-Output "PackageFamilyName: $($installedReport.PackageFamilyName)"
    Write-Output "SignatureKind: $($installedReport.SignatureKind)"
    Write-Output "Version: $($installedReport.Version)"
    Write-Output "Expected AUMID present: $(if ($installedReport.MatchingStartApps.Count -gt 0) { 'yes' } else { 'no' })"
  } else {
    Write-Output "Installed package was not found for the current user."
  }
} elseif ($SkipInstalledCheck) {
  Add-Warning "Installed package checks were skipped."
  $installedReport = [pscustomobject][ordered]@{
    Present = $false
    Skipped = $true
    ExpectedPackageFamilyName = $expectedPackageFamilyName
    ExpectedSignatureKind = $expectedSignatureKind
    ExpectedAUMID = $expectedAumid
  }
}

$report = [pscustomobject][ordered]@{
  GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  Expected = [pscustomobject][ordered]@{
    IdentityName = $expectedIdentityName
    ApplicationId = $expectedApplicationId
    Publisher = $expectedPublisher
    PublisherDisplayName = $expectedPublisherDisplayName
    DisplayName = $expectedDisplayName
    AppxVersion = $expectedAppxVersion
    PackageFamilyName = $expectedPackageFamilyName
    SignatureKind = $expectedSignatureKind
    AUMID = $expectedAumid
    ApplicationExecutable = $expectedExecutable
    ApplicationRuntimeBehavior = $expectedRuntimeBehavior
    ApplicationTrustLevel = $expectedTrustLevel
  }
  ProvenancePath = $ProvenancePath
  Provenance = $provenance
  Package = $packageInspection
  Installed = $installedReport
  Failures = @($failures)
  Warnings = @($warnings)
}

$reportDir = Split-Path -Parent $ReportPath
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$report | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $ReportPath -Encoding UTF8

Write-Section "Result"
if ($warnings.Count -gt 0) {
  foreach ($warning in $warnings) {
    Write-Output "WARN: $warning"
  }
}
if ($failures.Count -gt 0) {
  foreach ($failure in $failures) {
    Write-Output "FAIL: $failure"
  }
  Write-Output "Ingestion check report: $ReportPath"
  exit 1
}

Write-Output "Store ingestion check passed."
Write-Output "Ingestion check report: $ReportPath"

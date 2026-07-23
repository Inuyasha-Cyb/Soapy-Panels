$SoapyPackagingRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SoapyUap10Namespace = "http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
$SoapyDefaultProvenancePath = Join-Path $SoapyPackagingRoot "out\make\store-package-provenance.json"
$SoapyStoreInstalledIdentityPath = Join-Path $SoapyPackagingRoot "packaging\store-installed-identity.json"

function Get-SoapyPackageVersion {
  param(
    [string]$PackageJsonPath = (Join-Path $SoapyPackagingRoot "package.json")
  )

  $packageJson = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
  $version = [string]$packageJson.version
  if ([string]::IsNullOrWhiteSpace($version)) {
    throw "package.json version must be a non-empty string."
  }
  return $version
}

function ConvertTo-SoapyAppxVersion {
  param([string]$Version)

  if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Store package version must use three numeric parts: $Version."
  }
  return "$Version.0"
}

function Get-SoapyExpectedAppxVersion {
  return ConvertTo-SoapyAppxVersion (Get-SoapyPackageVersion)
}

function Select-SoapyApplicationById {
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

function Get-SoapyBuilderAppxConfig {
  $builderConfigPath = Join-Path $SoapyPackagingRoot "packaging\electron-builder.json"
  $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw | ConvertFrom-Json
  return $builderConfig.appx
}

function Get-SoapyStoreInstalledIdentityConfig {
  param(
    [string]$Path = $SoapyStoreInstalledIdentityPath
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Store installed identity config was not found at '$Path'."
  }

  $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $packageFamilyName = [string]$config.packageFamilyName
  $signatureKind = [string]$config.signatureKind
  if ([string]::IsNullOrWhiteSpace($packageFamilyName)) {
    throw "Store installed identity packageFamilyName must be a non-empty string."
  }
  if ([string]::IsNullOrWhiteSpace($signatureKind)) {
    throw "Store installed identity signatureKind must be a non-empty string."
  }

  return $config
}

function Get-SoapyExpectedPackageFamilyName {
  return [string](Get-SoapyStoreInstalledIdentityConfig).packageFamilyName
}

function Get-SoapyExpectedSignatureKind {
  return [string](Get-SoapyStoreInstalledIdentityConfig).signatureKind
}

function Get-SoapyExpectedAumid {
  param([string]$ApplicationId)

  if (-not $ApplicationId) {
    $ApplicationId = [string](Get-SoapyBuilderAppxConfig).applicationId
  }
  if ([string]::IsNullOrWhiteSpace($ApplicationId)) {
    throw "ApplicationId must be a non-empty string."
  }

  return "$(Get-SoapyExpectedPackageFamilyName)!$ApplicationId"
}

function Get-SoapyManifestSummaryFromManifestPath {
  param(
    [string]$ManifestPath,
    [string]$SourcePath = $ManifestPath,
    [string]$ApplicationId
  )

  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "AppxManifest.xml was not found at '$ManifestPath'."
  }

  if (-not $ApplicationId) {
    $ApplicationId = [string](Get-SoapyBuilderAppxConfig).applicationId
  }

  [xml]$manifest = Get-Content -LiteralPath $ManifestPath -Raw
  $identity = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
  $targetDeviceFamily = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Dependencies']/*[local-name()='TargetDeviceFamily']")
  $properties = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Properties']")
  $displayNameNode = if ($properties) {
    $properties.SelectSingleNode("*[local-name()='DisplayName']")
  } else {
    $null
  }
  $publisherDisplayNameNode = if ($properties) {
    $properties.SelectSingleNode("*[local-name()='PublisherDisplayName']")
  } else {
    $null
  }
  $application = Select-SoapyApplicationById -Manifest $manifest -ApplicationId $ApplicationId

  return [pscustomobject][ordered]@{
    SourcePath = $SourcePath
    ManifestPath = $ManifestPath
    IdentityName = if ($identity) { $identity.GetAttribute("Name") } else { "" }
    IdentityPublisher = if ($identity) { $identity.GetAttribute("Publisher") } else { "" }
    IdentityVersion = if ($identity) { $identity.GetAttribute("Version") } else { "" }
    TargetDeviceFamilyName = if ($targetDeviceFamily) { $targetDeviceFamily.GetAttribute("Name") } else { "" }
    TargetDeviceFamilyMinVersion = if ($targetDeviceFamily) { $targetDeviceFamily.GetAttribute("MinVersion") } else { "" }
    TargetDeviceFamilyMaxVersionTested = if ($targetDeviceFamily) { $targetDeviceFamily.GetAttribute("MaxVersionTested") } else { "" }
    DisplayName = if ($displayNameNode) { $displayNameNode.InnerText } else { "" }
    PublisherDisplayName = if ($publisherDisplayNameNode) { $publisherDisplayNameNode.InnerText } else { "" }
    ApplicationId = if ($application) { $application.GetAttribute("Id") } else { "" }
    ApplicationExecutable = if ($application) { $application.GetAttribute("Executable") } else { "" }
    ApplicationEntryPoint = if ($application) { $application.GetAttribute("EntryPoint") } else { "" }
    ApplicationRuntimeBehavior = if ($application) { $application.GetAttribute("RuntimeBehavior", $SoapyUap10Namespace) } else { "" }
    ApplicationTrustLevel = if ($application) { $application.GetAttribute("TrustLevel", $SoapyUap10Namespace) } else { "" }
  }
}

function Expand-SoapyPackageArchive {
  param(
    [string]$PackagePath,
    [string]$WorkDir
  )

  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $zipPath = Join-Path $WorkDir "package.zip"
  Copy-Item -LiteralPath $PackagePath -Destination $zipPath -Force
  Expand-Archive -LiteralPath $zipPath -DestinationPath $WorkDir -Force
}

function Get-SoapyManifestSummaryFromPackagePath {
  param(
    [string]$PackagePath,
    [string]$ApplicationId
  )

  if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
    throw "Package was not found at '$PackagePath'."
  }

  $packageItem = Get-Item -LiteralPath $PackagePath
  $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("soapy-package-summary-" + [System.Guid]::NewGuid().ToString("N"))
  try {
    Expand-SoapyPackageArchive -PackagePath $packageItem.FullName -WorkDir $workDir
    $manifestPath = Join-Path $workDir "AppxManifest.xml"

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
      $innerPackage = Get-ChildItem -LiteralPath $workDir -Recurse -File |
        Where-Object { $_.Extension -in ".appx",".msix" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

      if (-not $innerPackage) {
        throw "AppxManifest.xml or inner AppX/MSIX package was not found inside '$($packageItem.FullName)'."
      }

      $innerRoot = Join-Path $workDir "inner-package"
      Expand-SoapyPackageArchive -PackagePath $innerPackage.FullName -WorkDir $innerRoot
      $manifestPath = Join-Path $innerRoot "AppxManifest.xml"
      $summary = Get-SoapyManifestSummaryFromManifestPath -ManifestPath $manifestPath -SourcePath $packageItem.FullName -ApplicationId $ApplicationId
      $summary | Add-Member -NotePropertyName InnerPackageName -NotePropertyValue $innerPackage.Name
      return $summary
    }

    return Get-SoapyManifestSummaryFromManifestPath -ManifestPath $manifestPath -SourcePath $packageItem.FullName -ApplicationId $ApplicationId
  } finally {
    if (Test-Path -LiteralPath $workDir) {
      Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
    }
  }
}

function Get-SoapyCoreManifestFields {
  return @(
    "IdentityName",
    "IdentityPublisher",
    "IdentityVersion",
    "TargetDeviceFamilyName",
    "TargetDeviceFamilyMinVersion",
    "ApplicationId",
    "ApplicationExecutable",
    "ApplicationEntryPoint",
    "ApplicationRuntimeBehavior",
    "ApplicationTrustLevel"
  )
}

function Compare-SoapyManifestSummaryCore {
  param(
    $Expected,
    $Actual
  )

  $failures = @()
  foreach ($field in Get-SoapyCoreManifestFields) {
    $expectedValue = [string]$Expected.$field
    $actualValue = [string]$Actual.$field
    if ($expectedValue -ne $actualValue) {
      $failures += "$field is '$actualValue', expected '$expectedValue'."
    }
  }
  return $failures
}

function Write-SoapyPackageProvenance {
  param(
    [string]$PackagePath,
    [string]$OutputPath = $SoapyDefaultProvenancePath,
    [string]$UploadPath
  )

  $summary = Get-SoapyManifestSummaryFromPackagePath -PackagePath $PackagePath
  $provenance = [pscustomobject][ordered]@{
    GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    ExpectedPackageVersion = Get-SoapyPackageVersion
    ExpectedAppxVersion = Get-SoapyExpectedAppxVersion
    PackagePath = (Get-Item -LiteralPath $PackagePath).FullName
    UploadPath = if ($UploadPath) { (Get-Item -LiteralPath $UploadPath).FullName } else { $null }
    ManifestSummary = $summary
  }

  $outputDir = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  $provenance | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  return $provenance
}

function Get-SoapyLatestPackageProvenance {
  param(
    [string]$Path = $SoapyDefaultProvenancePath
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

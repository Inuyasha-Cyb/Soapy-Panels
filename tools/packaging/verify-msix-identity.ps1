param(
  [string]$MsixPath,
  [string]$ExpectedIdentityName,
  [string]$ExpectedIdentityVersion,
  [string]$ExpectedApplicationId,
  [string]$ExpectedPublisher,
  [string]$ExpectedPublisherDisplayName,
  [string]$ExpectedDisplayName,
  [string]$ExpectedApplicationExecutable = "app\SoapyPanels.exe",
  [string]$ExpectedApplicationRuntimeBehavior = "packagedClassicApp",
  [string]$ExpectedApplicationTrustLevel = "mediumIL",
  [string]$ExpectedTargetDeviceFamilyName = "Windows.Desktop",
  [string]$ExpectedTargetDeviceFamilyMinVersion,
  [string]$ExpectedAssetsDir = "out/packaging/appx"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$uap10Namespace = "http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
$minimumUap10MinVersion = "10.0.19041.0"
$builderConfigPath = Join-Path $root "packaging\electron-builder.json"
. (Join-Path $PSScriptRoot "store-package-helpers.ps1")

function Get-RequiredConfigValue($Name, $Value) {
  $stringValue = [string]$Value
  if ([string]::IsNullOrWhiteSpace($stringValue)) {
    throw "Electron Builder appx.$Name must be a non-empty string."
  }
  return $stringValue
}

function Get-RequiredFourPartVersion($Name, $Value) {
  $stringValue = Get-RequiredConfigValue $Name $Value
  if ($stringValue -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Electron Builder appx.$Name must use four-part version format: $stringValue."
  }
  return $stringValue
}

function Compare-FourPartVersion([string]$Left, [string]$Right) {
  $leftVersion = [version]$Left
  $rightVersion = [version]$Right
  return $leftVersion.CompareTo($rightVersion)
}

$builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw | ConvertFrom-Json
$appxConfig = $builderConfig.appx

if (-not $ExpectedIdentityName) {
  $ExpectedIdentityName = Get-RequiredConfigValue "identityName" $appxConfig.identityName
}
if (-not $ExpectedIdentityVersion) {
  $ExpectedIdentityVersion = Get-SoapyExpectedAppxVersion
}
if (-not $ExpectedApplicationId) {
  $ExpectedApplicationId = Get-RequiredConfigValue "applicationId" $appxConfig.applicationId
}
if (-not $ExpectedPublisher) {
  $ExpectedPublisher = Get-RequiredConfigValue "publisher" $appxConfig.publisher
}
if (-not $ExpectedPublisherDisplayName) {
  $ExpectedPublisherDisplayName = Get-RequiredConfigValue "publisherDisplayName" $appxConfig.publisherDisplayName
}
if (-not $ExpectedDisplayName) {
  $ExpectedDisplayName = Get-RequiredConfigValue "displayName" $appxConfig.displayName
}
if (-not $ExpectedTargetDeviceFamilyMinVersion) {
  $ExpectedTargetDeviceFamilyMinVersion = Get-RequiredFourPartVersion "minVersion" $appxConfig.minVersion
}

if ((Compare-FourPartVersion $ExpectedTargetDeviceFamilyMinVersion $minimumUap10MinVersion) -lt 0) {
  throw "Electron Builder appx.minVersion must be at least $minimumUap10MinVersion when using uap10 activation metadata: $ExpectedTargetDeviceFamilyMinVersion."
}

if ($ExpectedAssetsDir -and -not [System.IO.Path]::IsPathRooted($ExpectedAssetsDir)) {
  $ExpectedAssetsDir = Join-Path $root $ExpectedAssetsDir
}

if ($MsixPath -and -not [System.IO.Path]::IsPathRooted($MsixPath)) {
  $MsixPath = Join-Path $root $MsixPath
}

if (-not $MsixPath -or -not (Test-Path $MsixPath)) {
  $searchRoots = @(
    (Join-Path $root "dist"),
    (Join-Path $root "out\make\msix")
  )

  $package = $searchRoots |
    Where-Object { Test-Path $_ } |
    ForEach-Object {
      Get-ChildItem -Path $_ -Recurse -Include "*.appx","*.msix" -ErrorAction SilentlyContinue
      Get-ChildItem -Path $_ -Recurse -Include "*.appxupload","*.msixupload" -ErrorAction SilentlyContinue
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($package) {
    $MsixPath = $package.FullName
  }
}

if (-not $MsixPath -or -not (Test-Path $MsixPath)) {
  Write-Error "MSIX/AppX package or upload package not found. Run npm run make:msix first or pass -MsixPath."
  exit 1
}

$msixItem = Get-Item $MsixPath
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("soapy-msix-identity-" + [System.Guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $workDir "package.zip"
$packageRoot = $workDir

function Select-LocalNode($node, $localPath) {
  return $node.SelectSingleNode($localPath)
}

function Select-ApplicationById($manifest, $applicationId) {
  $applications = $manifest.SelectNodes("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
  foreach ($candidate in $applications) {
    if ($candidate.GetAttribute("Id") -eq $applicationId) {
      return $candidate
    }
  }
  return $null
}

function Get-Sha256Hash([string]$path) {
  $stream = [System.IO.File]::OpenRead($path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash($stream)
    return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "")
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

try {
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  Copy-Item -LiteralPath $msixItem.FullName -Destination $zipPath -Force
  Expand-Archive -LiteralPath $zipPath -DestinationPath $workDir -Force

  $manifestPath = Join-Path $packageRoot "AppxManifest.xml"
  if (-not (Test-Path $manifestPath)) {
    $innerPackage = Get-ChildItem -LiteralPath $workDir -Recurse -File |
      Where-Object { $_.Extension -in ".appx",".msix" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if ($innerPackage) {
      $packageRoot = Join-Path $workDir "inner-package"
      $innerZipPath = Join-Path $workDir "inner-package.zip"
      New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
      Copy-Item -LiteralPath $innerPackage.FullName -Destination $innerZipPath -Force
      Expand-Archive -LiteralPath $innerZipPath -DestinationPath $packageRoot -Force
      $manifestPath = Join-Path $packageRoot "AppxManifest.xml"
      Write-Output ("Inner AppX/MSIX package: {0}" -f $innerPackage.FullName)
    }
  }

  if (-not (Test-Path $manifestPath)) {
    Write-Error "AppxManifest.xml was not found inside $($msixItem.FullName)."
    exit 1
  }

  [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
  $identity = Select-LocalNode $manifest "/*[local-name()='Package']/*[local-name()='Identity']"
  $targetDeviceFamily = Select-LocalNode $manifest "/*[local-name()='Package']/*[local-name()='Dependencies']/*[local-name()='TargetDeviceFamily']"
  $properties = Select-LocalNode $manifest "/*[local-name()='Package']/*[local-name()='Properties']"
  $publisherDisplayNameNode = if ($properties) {
    Select-LocalNode $properties "*[local-name()='PublisherDisplayName']"
  } else {
    $null
  }
  $displayNameNode = if ($properties) {
    Select-LocalNode $properties "*[local-name()='DisplayName']"
  } else {
    $null
  }
  $visualElements = Select-LocalNode $manifest "//*[local-name()='VisualElements']"
  $application = Select-ApplicationById $manifest $ExpectedApplicationId

  if (-not $identity) {
    Write-Error "Identity element was not found in AppxManifest.xml."
    exit 1
  }

  $actualIdentityName = $identity.GetAttribute("Name")
  $actualIdentityVersion = $identity.GetAttribute("Version")
  $actualPublisher = $identity.GetAttribute("Publisher")
  $actualPublisherDisplayName = if ($publisherDisplayNameNode) {
    $publisherDisplayNameNode.InnerText
  } else {
    ""
  }
  $actualDisplayName = if ($displayNameNode -and $displayNameNode.InnerText) {
    $displayNameNode.InnerText
  } elseif ($visualElements) {
    $visualElements.GetAttribute("DisplayName")
  } else {
    ""
  }
  $actualTargetDeviceFamilyName = if ($targetDeviceFamily) {
    $targetDeviceFamily.GetAttribute("Name")
  } else {
    ""
  }
  $actualTargetDeviceFamilyMinVersion = if ($targetDeviceFamily) {
    $targetDeviceFamily.GetAttribute("MinVersion")
  } else {
    ""
  }
  $actualApplicationExecutable = if ($application) {
    $application.GetAttribute("Executable")
  } else {
    ""
  }
  $actualApplicationId = if ($application) {
    $application.GetAttribute("Id")
  } else {
    ""
  }
  $actualApplicationEntryPoint = if ($application) {
    $application.GetAttribute("EntryPoint")
  } else {
    ""
  }
  $actualApplicationRuntimeBehavior = if ($application) {
    $application.GetAttribute("RuntimeBehavior", $uap10Namespace)
  } else {
    ""
  }
  $actualApplicationTrustLevel = if ($application) {
    $application.GetAttribute("TrustLevel", $uap10Namespace)
  } else {
    ""
  }

  Write-Output ("Checking package: {0}" -f $msixItem.FullName)
  Write-Output ("Identity Name: {0}" -f $actualIdentityName)
  Write-Output ("Identity Version: {0}" -f $actualIdentityVersion)
  Write-Output ("Identity Publisher: {0}" -f $actualPublisher)
  Write-Output ("PublisherDisplayName: {0}" -f $actualPublisherDisplayName)
  Write-Output ("DisplayName: {0}" -f $actualDisplayName)
  Write-Output ("TargetDeviceFamily Name: {0}" -f $actualTargetDeviceFamilyName)
  Write-Output ("TargetDeviceFamily MinVersion: {0}" -f $actualTargetDeviceFamilyMinVersion)
  Write-Output ("Application Id: {0}" -f $actualApplicationId)
  Write-Output ("Application Executable: {0}" -f $actualApplicationExecutable)
  Write-Output ("Application EntryPoint: {0}" -f $actualApplicationEntryPoint)
  Write-Output ("Application RuntimeBehavior: {0}" -f $actualApplicationRuntimeBehavior)
  Write-Output ("Application TrustLevel: {0}" -f $actualApplicationTrustLevel)

  $failures = @()
  if ($actualIdentityName -ne $ExpectedIdentityName) {
    $failures += "Identity Name is '$actualIdentityName', expected '$ExpectedIdentityName'."
  }
  if ($actualIdentityVersion -ne $ExpectedIdentityVersion) {
    $failures += "Identity Version is '$actualIdentityVersion', expected '$ExpectedIdentityVersion'."
  }
  if ($actualPublisher -ne $ExpectedPublisher) {
    $failures += "Identity Publisher is '$actualPublisher', expected '$ExpectedPublisher'."
  }
  if ($actualPublisherDisplayName -ne $ExpectedPublisherDisplayName) {
    $failures += "PublisherDisplayName is '$actualPublisherDisplayName', expected '$ExpectedPublisherDisplayName'."
  }
  if ($actualDisplayName -ne $ExpectedDisplayName) {
    $failures += "DisplayName is '$actualDisplayName', expected '$ExpectedDisplayName'."
  }
  if ($actualTargetDeviceFamilyName -ne $ExpectedTargetDeviceFamilyName) {
    $failures += "TargetDeviceFamily Name is '$actualTargetDeviceFamilyName', expected '$ExpectedTargetDeviceFamilyName'."
  }
  if ($actualTargetDeviceFamilyMinVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    $failures += "TargetDeviceFamily MinVersion must use four-part version format, found '$actualTargetDeviceFamilyMinVersion'."
  } elseif ((Compare-FourPartVersion $actualTargetDeviceFamilyMinVersion $ExpectedTargetDeviceFamilyMinVersion) -lt 0) {
    $failures += "TargetDeviceFamily MinVersion is '$actualTargetDeviceFamilyMinVersion', expected at least '$ExpectedTargetDeviceFamilyMinVersion'."
  } elseif ((Compare-FourPartVersion $actualTargetDeviceFamilyMinVersion $minimumUap10MinVersion) -lt 0) {
    $failures += "TargetDeviceFamily MinVersion is '$actualTargetDeviceFamilyMinVersion', expected at least '$minimumUap10MinVersion' for uap10 activation metadata."
  }
  if ($actualApplicationId -ne $ExpectedApplicationId) {
    $failures += "Application Id is '$actualApplicationId', expected '$ExpectedApplicationId'."
  }
  if ($actualApplicationExecutable -ne $ExpectedApplicationExecutable) {
    $failures += "Application Executable is '$actualApplicationExecutable', expected '$ExpectedApplicationExecutable'."
  }
  if ($actualApplicationEntryPoint) {
    $failures += "Application EntryPoint must be empty when using uap10 runtime/trust metadata, found '$actualApplicationEntryPoint'."
  }
  if ($actualApplicationRuntimeBehavior -ne $ExpectedApplicationRuntimeBehavior) {
    $failures += "Application RuntimeBehavior is '$actualApplicationRuntimeBehavior', expected '$ExpectedApplicationRuntimeBehavior'."
  }
  if ($actualApplicationTrustLevel -ne $ExpectedApplicationTrustLevel) {
    $failures += "Application TrustLevel is '$actualApplicationTrustLevel', expected '$ExpectedApplicationTrustLevel'."
  }
  if ($ExpectedApplicationExecutable) {
    $expectedExecutablePath = Join-Path $packageRoot $ExpectedApplicationExecutable
    if (-not (Test-Path -LiteralPath $expectedExecutablePath -PathType Leaf)) {
      $failures += "Packaged AppX executable is missing: '$ExpectedApplicationExecutable'."
    }
  }
  $electronExecutablePath = Join-Path $packageRoot "app\SoapyPanels.exe"
  if (-not (Test-Path -LiteralPath $electronExecutablePath -PathType Leaf)) {
    $failures += "Packaged Electron executable is missing: 'app\SoapyPanels.exe'."
  }

  if (-not $ExpectedAssetsDir -or -not (Test-Path $ExpectedAssetsDir)) {
    $failures += "Expected AppX asset directory was not found at '$ExpectedAssetsDir'. Run npm run msix:assets first."
  } else {
    $expectedAssets = Get-ChildItem -LiteralPath $ExpectedAssetsDir -File |
      Where-Object { $_.Extension -in ".png",".ico" }
    $verifiedAssetCount = 0

    if ($expectedAssets.Count -eq 0) {
      $failures += "Expected AppX asset directory has no PNG or ICO files: '$ExpectedAssetsDir'. Run npm run msix:assets first."
    }

    foreach ($expectedAsset in $expectedAssets) {
      $actualAssetPath = Join-Path (Join-Path $packageRoot "assets") $expectedAsset.Name
      if (-not (Test-Path $actualAssetPath)) {
        $failures += "Packaged AppX asset is missing: assets\$($expectedAsset.Name)."
        continue
      }

      $expectedHash = Get-Sha256Hash $expectedAsset.FullName
      $actualHash = Get-Sha256Hash $actualAssetPath
      if ($actualHash -ne $expectedHash) {
        $failures += "Packaged AppX asset does not match generated Soapy asset: assets\$($expectedAsset.Name)."
        continue
      }

      $verifiedAssetCount += 1
    }

    Write-Output ("Verified AppX assets: {0}" -f $verifiedAssetCount)
  }

  if ($failures.Count -gt 0) {
    foreach ($failure in $failures) {
      Write-Error $failure
    }
    exit 1
  }

  Write-Output "MSIX/AppX identity verification passed."
} finally {
  if (Test-Path $workDir) {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  }
}

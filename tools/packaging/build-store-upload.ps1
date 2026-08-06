param()

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$distPath = Join-Path $root "dist"
$outMakePath = Join-Path $root "out\make"
$provenancePath = Join-Path $root "out\make\store-package-provenance.json"
$builderConfigPath = Join-Path $root "packaging\electron-builder.json"
$packageJsonPath = Join-Path $root "package.json"

function Find-WindowsSdkMakeAppx {
  $sdkRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
  if (-not (Test-Path -LiteralPath $sdkRoot -PathType Container)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $sdkRoot -Recurse -Filter "makeappx.exe" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\x64\makeappx.exe" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
}

function Invoke-StagedAppxFallback {
  $stagedDir = Get-ChildItem -LiteralPath $distPath -Directory -Filter "__appx-*" -ErrorAction SilentlyContinue |
    Where-Object {
      (Test-Path -LiteralPath (Join-Path $_.FullName "mapping.txt") -PathType Leaf) -and
      (Test-Path -LiteralPath (Join-Path $_.FullName "AppxManifest.xml") -PathType Leaf)
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $stagedDir) {
    throw "npm run make:msix failed with exit code $LASTEXITCODE, and no staged AppX directory was found for fallback packaging."
  }

  $makeAppx = Find-WindowsSdkMakeAppx
  if (-not $makeAppx) {
    throw "npm run make:msix failed with exit code $LASTEXITCODE, and Windows SDK makeappx.exe was not found for fallback packaging."
  }

  $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw | ConvertFrom-Json
  $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  $productName = [string]$builderConfig.productName
  if ([string]::IsNullOrWhiteSpace($productName)) {
    $productName = [string]$packageJson.name
  }
  $packageVersion = [string]$packageJson.version
  if ([string]::IsNullOrWhiteSpace($packageVersion)) {
    throw "package.json version must be a non-empty string for fallback packaging."
  }

  $fallbackPackagePath = Join-Path $distPath "$productName $packageVersion.appx"
  $mappingPath = Join-Path $stagedDir.FullName "mapping.txt"

  Write-Output "Electron Builder staged AppX files but its bundled MakeAppx failed."
  Write-Output "Fallback MakeAppx: $($makeAppx.FullName)"
  Write-Output "Fallback mapping: $mappingPath"
  Write-Output "Fallback package: $fallbackPackagePath"

  if (Test-Path -LiteralPath $fallbackPackagePath) {
    Remove-Item -LiteralPath $fallbackPackagePath -Force
  }

  & $makeAppx.FullName pack /o /f $mappingPath /p $fallbackPackagePath
  if ($LASTEXITCODE -ne 0) {
    throw "Fallback Windows SDK makeappx.exe failed with exit code $LASTEXITCODE."
  }

  return Get-Item -LiteralPath $fallbackPackagePath
}

Write-Output "Cleaning generated Store package output..."
if (Test-Path $distPath) {
  Remove-Item -Recurse -Force $distPath
}
if (Test-Path $outMakePath) {
  Remove-Item -Recurse -Force $outMakePath
}

Push-Location $root
try {
  Write-Output "Building fresh AppX/MSIX package..."
  & npm.cmd run make:msix
  if ($LASTEXITCODE -ne 0) {
    Write-Output "npm run make:msix failed with exit code $LASTEXITCODE. Attempting Windows SDK MakeAppx fallback..."
    Invoke-StagedAppxFallback | Out-Null
  }
} finally {
  Pop-Location
}

$package = Get-ChildItem -Path $distPath -Recurse -Include "*.appx","*.msix" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $package) {
  throw "Fresh AppX/MSIX package was not found under dist after npm run make:msix."
}

Write-Output ("Fresh package: {0}" -f $package.FullName)

Write-Output "Verifying AppX/MSIX manifest identity and AppX assets..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-msix-identity.ps1") -MsixPath $package.FullName
if ($LASTEXITCODE -ne 0) {
  throw "MSIX/AppX verification failed with exit code $LASTEXITCODE."
}

Write-Output "Creating Store upload package from the verified package..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "make-msixupload.ps1") -MsixPath $package.FullName
if ($LASTEXITCODE -ne 0) {
  throw "Store upload package creation failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $provenancePath -PathType Leaf)) {
  throw "Store package provenance was not created at $provenancePath."
}

Write-Output ("Store package provenance: {0}" -f $provenancePath)

Write-Output "Store package pipeline completed."

param(
  [string]$MsixPath
)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "store-package-helpers.ps1")
if ($MsixPath -and -not [System.IO.Path]::IsPathRooted($MsixPath)) {
  $MsixPath = Join-Path $root $MsixPath
}
$defaultSearch = Join-Path $root "out\make\msix"
$builderSearch = Join-Path $root "dist"

if (-not $MsixPath -or -not (Test-Path $MsixPath)) {
  if (Test-Path $defaultSearch) {
    $msixItem = Get-ChildItem -Path $defaultSearch -Recurse -Include "*.msix","*.appx" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($msixItem) {
      $MsixPath = $msixItem.FullName
    }
  }
}

if (-not $MsixPath -or -not (Test-Path $MsixPath)) {
  if (Test-Path $builderSearch) {
    $msixItem = Get-ChildItem -Path $builderSearch -Recurse -Include "*.msix","*.appx" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($msixItem) {
      $MsixPath = $msixItem.FullName
    }
  }
}

if (-not $MsixPath -or -not (Test-Path $MsixPath)) {
  Write-Error "MSIX/AppX not found. Build one first (npm run make:msix) or pass -MsixPath."
  exit 1
}

$msixItem = Get-Item $MsixPath
Write-Output ("Selected Store package: {0}" -f $msixItem.FullName)

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-msix-identity.ps1") -MsixPath $msixItem.FullName
if ($LASTEXITCODE -ne 0) {
  Write-Error "Refusing to create Store upload package because MSIX/AppX verification failed."
  exit $LASTEXITCODE
}

$msixDir = $msixItem.Directory.FullName
$msixBase = [System.IO.Path]::GetFileNameWithoutExtension($msixItem.Name)
$packageExt = $msixItem.Extension.ToLowerInvariant()
$uploadExt = if ($packageExt -eq ".appx") { ".appxupload" } else { ".msixupload" }

# Try to keep architecture segment if it exists in the path (e.g. out\make\msix\x64)
$archSegment = Split-Path -Leaf $msixDir
$outDir = Join-Path $root "out\make\msixupload\$archSegment"
$stagingDir = Join-Path $outDir "staging"

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

# Try to build an .appxsym from any PDBs in the packaged output
$packagedDir = Get-ChildItem -Path (Join-Path $root "out") -Directory -Filter "*-win32-$archSegment" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$generatedAppxSym = $null

if ($packagedDir) {
  $pdbs = Get-ChildItem -Path $packagedDir.FullName -Recurse -Filter "*.pdb" -ErrorAction SilentlyContinue
  if ($pdbs -and $pdbs.Count -gt 0) {
    $symStagingDir = Join-Path $outDir "symbols"
    New-Item -ItemType Directory -Force -Path $symStagingDir | Out-Null

    foreach ($pdb in $pdbs) {
      $rel = $pdb.FullName.Substring($packagedDir.FullName.Length).TrimStart("\")
      $dest = Join-Path $symStagingDir $rel
      $destDir = Split-Path $dest -Parent
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
      Copy-Item -Force $pdb.FullName -Destination $dest
    }

    $appxSymPath = Join-Path $outDir ("$msixBase.appxsym")
    $appxSymZip = Join-Path $outDir ("$msixBase.appxsym.zip")
    if (Test-Path $appxSymPath) { Remove-Item -Force $appxSymPath }
    if (Test-Path $appxSymZip) { Remove-Item -Force $appxSymZip }

    Compress-Archive -Path (Join-Path $symStagingDir "*") -DestinationPath $appxSymZip -Force
    Move-Item -Force $appxSymZip $appxSymPath
    Remove-Item -Recurse -Force $symStagingDir
    $generatedAppxSym = $appxSymPath
  }
}

Copy-Item -Force $msixItem.FullName -Destination $stagingDir

if ($generatedAppxSym -and (Test-Path $generatedAppxSym)) {
  Copy-Item -Force $generatedAppxSym -Destination $stagingDir
} else {
  # Include appxsym if it exists alongside the MSIX (optional for Store but useful for diagnostics)
  $symbols = Get-ChildItem -Path $msixDir -Filter "*.appxsym" -ErrorAction SilentlyContinue
  if ($symbols) {
    $symbols | ForEach-Object { Copy-Item -Force $_.FullName -Destination $stagingDir }
  }
}

$uploadPath = Join-Path $outDir ("$msixBase$uploadExt")
$zipPath = Join-Path $outDir ("$msixBase.zip")

if (Test-Path $uploadPath) {
  Remove-Item -Force $uploadPath
}
if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Compress-Archive -Path (Join-Path $stagingDir "*") -DestinationPath $zipPath -Force
Move-Item -Force $zipPath $uploadPath

# Clean staging
Remove-Item -Recurse -Force $stagingDir

$sidecarProvenancePath = "$uploadPath.provenance.json"
$centralProvenancePath = Join-Path $root "out\make\store-package-provenance.json"
Write-SoapyPackageProvenance -PackagePath $uploadPath -UploadPath $uploadPath -OutputPath $sidecarProvenancePath | Out-Null
Write-SoapyPackageProvenance -PackagePath $uploadPath -UploadPath $uploadPath -OutputPath $centralProvenancePath | Out-Null

Write-Output ("Created Store upload: {0}" -f $uploadPath)
Write-Output ("Created Store package provenance: {0}" -f $sidecarProvenancePath)
Write-Output ("Updated latest Store package provenance: {0}" -f $centralProvenancePath)
if ($generatedAppxSym -and (Test-Path $generatedAppxSym)) {
  Write-Output ("Included symbols: {0}" -f $generatedAppxSym)
} else {
  Write-Output ("No PDB symbols found; {0} created without an .appxsym file." -f $uploadExt)
}

param(
  [string]$IcoPath = "packaging/assets/icons/icon.ico",
  [string]$PngPath = "packaging/assets/icons/icon.png",
  [string]$OutDir = "out/packaging/appx"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Resolve-RepoPath([string]$path) {
  if ([System.IO.Path]::IsPathRooted($path)) { return $path }
  return Join-Path $RepoRoot $path
}

$IcoPath = Resolve-RepoPath $IcoPath
$PngPath = Resolve-RepoPath $PngPath
$OutDir = Resolve-RepoPath $OutDir

function New-Image([string]$path) {
  if (-not (Test-Path $path)) { return $null }

  $resolved = (Resolve-Path $path).Path
  $ext = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
  if ($ext -eq ".ico") {
    $icon = New-Object System.Drawing.Icon $resolved
    try {
      return $icon.ToBitmap()
    } finally {
      $icon.Dispose()
    }
  }

  return [System.Drawing.Image]::FromFile($resolved)
}

function Get-AssetSource([string]$name, [System.Drawing.Image]$fallback) {
  $candidates = @(
    (Join-Path $RepoRoot ("packaging/assets/" + $name)),
    (Join-Path $RepoRoot ("packaging/assets/icons/" + $name))
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return @{ Image = (New-Image $candidate); Owned = $true; Path = $candidate }
    }
  }

  return @{ Image = $fallback; Owned = $false; Path = $null }
}

function Save-Resized([System.Drawing.Image]$src, [int]$w, [int]$h, [string]$outPath) {
  if (-not $src) {
    throw "Cannot generate $outPath because no source image is available."
  }

  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($src, 0, 0, $w, $h)
    $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$srcIco = New-Image $IcoPath
$srcPng = New-Image $PngPath

if (-not $srcPng -and -not $srcIco) {
  Write-Error "No source images found. Expected $IcoPath or $PngPath."
  exit 1
}

if (Test-Path $OutDir) {
  Get-ChildItem -LiteralPath $OutDir -Force | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

$smallSrc = if ($srcIco) { $srcIco } else { $srcPng }
$largeSrc = if ($srcPng) { $srcPng } else { $srcIco }

# Electron Builder reads custom AppX assets from buildResources/appx.
# These names match the manifest references it emits and prevent fallback to
# bundled Electron sample images.
$assets = @(
  @{ Name = "StoreLogo.png"; Width = 50; Height = 50; Fallback = $largeSrc },
  @{ Name = "icon.png"; Width = 256; Height = 256; Fallback = $largeSrc },
  @{ Name = "Square44x44Logo.png"; Width = 44; Height = 44; Fallback = $smallSrc },
  @{ Name = "Square150x150Logo.png"; Width = 150; Height = 150; Fallback = $largeSrc },
  @{ Name = "Wide310x150Logo.png"; Width = 310; Height = 150; Fallback = $largeSrc },
  @{ Name = "SplashScreen.png"; Width = 620; Height = 300; Fallback = $largeSrc }
)

try {
  foreach ($asset in $assets) {
    $source = Get-AssetSource -name $asset.Name -fallback $asset.Fallback
    $dest = Join-Path $OutDir $asset.Name
    try {
      Save-Resized -src $source.Image -w $asset.Width -h $asset.Height -outPath $dest
    } finally {
      if ($source.Owned -and $source.Image) {
        $source.Image.Dispose()
      }
    }
  }
} finally {
  if ($srcIco) { $srcIco.Dispose() }
  if ($srcPng) { $srcPng.Dispose() }
}

Write-Output ("Generated MSIX/AppX assets in {0}" -f (Resolve-Path $OutDir))

param(
[string]$IcoPath = "packaging/assets/icons/icon.ico",
[string]$PngPath = "packaging/assets/icons/icon.png",
  [string]$OutDir = "out/packaging/store-listing"
)

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
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($ext -eq ".ico") {
    try {
      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path $path))
      if ($icon) { return $icon.ToBitmap() }
    } catch {
      return $null
    }
  }
  return [System.Drawing.Image]::FromFile((Resolve-Path $path))
}

function New-Canvas([System.Drawing.Image]$src, [int]$w, [int]$h, [string]$outPath, [double]$scale) {
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $maxSize = [Math]::Min($w, $h) * $scale
  $ratio = $src.Width / $src.Height
  if ($ratio -ge 1) {
    $drawW = [Math]::Round($maxSize)
    $drawH = [Math]::Round($maxSize / $ratio)
  } else {
    $drawH = [Math]::Round($maxSize)
    $drawW = [Math]::Round($maxSize * $ratio)
  }

  $x = [Math]::Round(($w - $drawW) / 2)
  $y = [Math]::Round(($h - $drawH) / 2)
  $graphics.DrawImage($src, $x, $y, $drawW, $drawH)

  $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Save-Resized([System.Drawing.Image]$src, [int]$w, [int]$h, [string]$outPath) {
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($src, 0, 0, $w, $h)
  $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$srcPng = New-Image $PngPath
$srcIco = New-Image $IcoPath

if (-not $srcPng -and -not $srcIco) {
  Write-Error "No source images found. Expected $IcoPath or $PngPath."
  exit 1
}

$logoSrc = $srcPng
if (-not $logoSrc) { $logoSrc = $srcIco }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 1:1 app tile icon (300x300)
Save-Resized -src $logoSrc -w 300 -h 300 -outPath (Join-Path $OutDir "AppTileIcon-300x300.png")

# Optional promo art sizes (no text)
New-Canvas -src $logoSrc -w 720 -h 1080 -outPath (Join-Path $OutDir "PosterArt-720x1080.png") -scale 0.6
New-Canvas -src $logoSrc -w 1440 -h 2160 -outPath (Join-Path $OutDir "PosterArt-1440x2160.png") -scale 0.6
New-Canvas -src $logoSrc -w 1920 -h 1080 -outPath (Join-Path $OutDir "SuperHeroArt-1920x1080.png") -scale 0.55

if ($srcPng) { $srcPng.Dispose() }
if ($srcIco) { $srcIco.Dispose() }

Write-Output ("Generated Store listing assets in {0}" -f (Resolve-Path $OutDir))

# Check the icons inside the newest Microsoft Store package for Soapy Panels.
# Place this file here:
# tools\packaging\check-store-icons.ps1

$ErrorActionPreference = "Stop"

# This script is expected to live in: <project-root>\tools\packaging
# Move back to the project root so relative paths like .\dist and .\out\make work correctly.
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $projectRoot

Write-Host "Project root: $projectRoot" -ForegroundColor DarkCyan

# Clean old unpack folder
Remove-Item -Recurse -Force ".\unpacked-icon-check" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force ".\unpacked-icon-check" | Out-Null

# Find newest package/upload file
$pkg = Get-ChildItem -Path ".\dist", ".\out\make" -Recurse -Include *.appx, *.msix, *.appxupload, *.msixupload -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $pkg) {
  Write-Host "No .appx, .msix, .appxupload, or .msixupload found." -ForegroundColor Red
  exit 1
}

Write-Host "Found newest package: $($pkg.FullName)" -ForegroundColor Cyan

# If it is an upload package, unpack it first and find the inner .appx/.msix
$innerPackage = $pkg.FullName

if ($pkg.Extension -in ".appxupload", ".msixupload") {
  $uploadDir = ".\unpacked-icon-check\upload"
  New-Item -ItemType Directory -Force $uploadDir | Out-Null

  $uploadZip = ".\unpacked-icon-check\upload.zip"
  Copy-Item $pkg.FullName $uploadZip -Force
  Expand-Archive -Path $uploadZip -DestinationPath $uploadDir -Force

  $inner = Get-ChildItem -Path $uploadDir -Recurse -Include *.appx, *.msix |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $inner) {
    Write-Host "No inner .appx/.msix found inside the upload package." -ForegroundColor Red
    exit 1
  }

  $innerPackage = $inner.FullName
  Write-Host "Inner package: $innerPackage" -ForegroundColor Cyan
}

# Unpack the actual .appx/.msix
$appDir = ".\unpacked-icon-check\app"
New-Item -ItemType Directory -Force $appDir | Out-Null

$appZip = ".\unpacked-icon-check\app.zip"
Copy-Item $innerPackage $appZip -Force
Expand-Archive -Path $appZip -DestinationPath $appDir -Force

# Show manifest icon references
Write-Host "`nManifest icon/display references:" -ForegroundColor Yellow
Select-String -Path "$appDir\AppxManifest.xml" -Pattern "Logo|DisplayName|PublisherDisplayName|Identity" | ForEach-Object {
  $_.Line
}

# Show image assets
Write-Host "`nImage assets found:" -ForegroundColor Yellow
Get-ChildItem -Path $appDir -Recurse -Include *.png, *.ico |
  Select-Object Name, Length, FullName |
  Format-Table -AutoSize

# Open unpacked folder in Explorer
explorer $appDir

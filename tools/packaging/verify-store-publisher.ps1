param(
  [string]$ExpectedPublisherDisplayName = "Soapy Panels",
  [string]$ExpectedAppDisplayName = "Soapy Panels",
  [string]$Repo = ""
)

$ErrorActionPreference = "Stop"

$originalLocation = (Get-Location).Path
if ($Repo) {
  Set-Location -LiteralPath (Resolve-Path -LiteralPath $Repo).Path
}

try {
  Write-Output "store:publisher now runs the Store ingestion manifest check with installed-package checks skipped."
  Write-Output "ExpectedPublisherDisplayName and ExpectedAppDisplayName are kept for command compatibility; packaging/electron-builder.json is the source of truth."

  $scriptPath = Join-Path $PSScriptRoot "verify-store-ingestion.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -SkipInstalledCheck
  exit $LASTEXITCODE
} finally {
  Set-Location -LiteralPath $originalLocation
}

param()

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$source = Join-Path $PSScriptRoot "store-launcher\SoapyStoreLauncher.cs"
$outDir = Join-Path $root "out\store-launcher"
$outExe = Join-Path $outDir "SoapyStoreLauncher.exe"
$icon = Join-Path $root "packaging\assets\icons\icon.ico"

$compilerCandidates = @(
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)

$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) {
  throw "Could not find the .NET Framework C# compiler. Expected csc.exe under $env:WINDIR\Microsoft.NET\Framework64\v4.0.30319."
}

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Store launcher source was not found: $source"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$args = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/platform:x64",
  "/out:$outExe"
)

if (Test-Path -LiteralPath $icon -PathType Leaf) {
  $args += "/win32icon:$icon"
}

$args += $source

Write-Output ("Building Store launcher: {0}" -f $outExe)
& $compiler @args
if ($LASTEXITCODE -ne 0) {
  throw "Store launcher build failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $outExe -PathType Leaf)) {
  throw "Store launcher output was not created: $outExe"
}

Write-Output ("Store launcher built: {0}" -f $outExe)

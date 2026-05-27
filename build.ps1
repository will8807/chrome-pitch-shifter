$root    = $PSScriptRoot
$out     = Join-Path $root "dist\pitch-shifter.zip"
$staging = Join-Path $root "dist\.staging"

$include = @(
  "manifest.json",
  "background\service-worker.js",
  "content\content-script.js",
  "popup\popup.html",
  "popup\popup.css",
  "popup\popup.js",
  "offscreen\offscreen.html",
  "offscreen\offscreen.js",
  "worklets\pitch-shift-processor.js",
  "icons\icon16.png",
  "icons\icon48.png",
  "icons\icon128.png"
)

# Clean staging dir
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# Copy files preserving folder structure
foreach ($rel in $include) {
  $src  = Join-Path $root $rel
  $dest = Join-Path $staging $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item $src $dest
}

# Zip and clean up
New-Item -ItemType Directory -Force -Path (Join-Path $root "dist") | Out-Null
if (Test-Path $out) { Remove-Item $out }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $out
Remove-Item $staging -Recurse -Force

Write-Host "Built: $out"

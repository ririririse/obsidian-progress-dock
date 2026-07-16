param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'release'
$target = Join-Path $VaultPath '.obsidian\plugins\progress-dock'

if (-not (Test-Path (Join-Path $VaultPath '.obsidian'))) {
    throw 'The selected folder is not an Obsidian vault.'
}

if (-not (Test-Path (Join-Path $source 'main.js'))) {
    throw 'Build the plugin first so the release folder exists.'
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'main.js') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $source 'manifest.json') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $source 'styles.css') -Destination $target -Force
Write-Host "Progress Dock installed to $target" -ForegroundColor Green
Write-Host 'Reload Obsidian, then enable Progress Dock under Community plugins.' -ForegroundColor Cyan

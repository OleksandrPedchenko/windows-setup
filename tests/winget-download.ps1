$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$destination = Join-Path $work 'installers'
$null = New-Item -ItemType Directory -Path $destination -Force
$configPath = Join-Path $work 'packages.json'
Copy-Item -LiteralPath (Join-Path $root 'download.ps1') -Destination (Join-Path $work 'download.ps1')
@{ packages = @(@{ name = 'Example app'; source = 'winget'; id = 'Example.App' }) } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath
Set-Content -LiteralPath (Join-Path $destination 'existing.yaml') -Value 'keep me'
function Read-Host { '' }

function winget {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'show') { 'Version: 2.0'; return }
    if ($args[0] -eq 'download' -and $args[1] -eq '--help') { 'download help'; return }
    $directory = $args[[array]::IndexOf($args, '--download-directory') + 1]
    Set-Content -LiteralPath (Join-Path $directory 'Example-2.0.exe') -Value 'installer'
    Set-Content -LiteralPath (Join-Path $directory 'Example-2.0.yaml') -Value 'manifest'
}

try {
    & (Join-Path $work 'download.ps1') -ConfigPath $configPath -Destination $destination
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'Example-2.0.exe'))) { throw 'Installer was not saved in the destination.' }
    if (Test-Path -LiteralPath (Join-Path $destination 'Example-2.0.yaml')) { throw 'WinGet YAML was left beside installers.' }
    if ((Get-Content -LiteralPath (Join-Path $destination 'existing.yaml') -Raw).Trim() -ne 'keep me') { throw 'Existing YAML was changed.' }
    if (@(Get-ChildItem -LiteralPath $destination -Directory).Count -ne 0) { throw 'Temporary download folder was not removed.' }
    Write-Host 'WinGet installer-only smoke test OK'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

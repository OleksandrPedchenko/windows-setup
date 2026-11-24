$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
$configPath = Join-Path $work 'packages.json'
@{
    packages = @(@{
        name = 'Example ISO'
        source = 'google-drive'
        id = 'example-file-id'
        filename = 'Example.iso'
        version = '1.2.3'
    })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath

function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    $global:requestedUrl = $Uri
    if ($global:responseHtml) {
        [System.IO.File]::WriteAllText($OutFile, '<!DOCTYPE html><title>Warning</title>')
    } else {
        [System.IO.File]::WriteAllBytes($OutFile, [byte[]](0, 1, 2, 3))
    }
}

try {
    & (Join-Path $root 'download.ps1') -ConfigPath $configPath -Destination (Join-Path $work 'output')
    $expectedUrl = 'https://drive.usercontent.google.com/download?id=example-file-id&export=download&confirm=t'
    if ($global:requestedUrl -ne $expectedUrl) { throw 'The configured Drive file was not requested.' }
    if (-not (Test-Path -LiteralPath (Join-Path $work 'output/Example.iso'))) { throw 'The ISO was not saved.' }
    $global:responseHtml = $true
    try {
        & (Join-Path $root 'download.ps1') -ConfigPath $configPath -Destination (Join-Path $work 'bad-output')
        throw 'An HTML response was incorrectly accepted.'
    } catch {
        if ($_.Exception.Message -eq 'An HTML response was incorrectly accepted.') { throw }
    }
    if (Test-Path -LiteralPath (Join-Path $work 'bad-output/Example.iso')) { throw 'HTML was saved as an ISO.' }
    if (Test-Path -LiteralPath (Join-Path $work 'bad-output/Example.iso.partial')) { throw 'Partial download was not removed.' }
    Write-Host 'Google Drive download smoke test OK'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

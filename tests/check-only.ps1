$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
$configPath = Join-Path $work 'packages.json'
$destination = Join-Path $work 'output'
Copy-Item -LiteralPath (Join-Path $root 'drive/Tools/Scripts/download.ps1') -Destination (Join-Path $work 'download.ps1')
@{
    packages = @(
        @{ name = 'Public app'; source = 'winget'; id = 'Example.Public' },
        @{ name = 'Example ISO'; source = 'google-drive'; id = 'example-file-id'; filename = 'Example.iso'; version = '1.2.3' }
    )
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath

function Read-Host { '' }
function winget {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'show') { 'Version: 2.0'; 'Installer Url: https://example.test/Public-2.0.exe'; return }
    if ($args[0] -eq 'download' -and $args[1] -eq '--help') { 'download help'; return }
    $global:downloadCalls++
}
function Invoke-WebRequest {
    param([string]$Uri, [string]$Method, [switch]$UseBasicParsing, [string]$OutFile)
    if ($Method -ne 'Head') { $global:downloadCalls++; throw 'A file download was attempted.' }
    $global:headCalls++
    [pscustomobject]@{
        StatusCode = 200
        Headers = @{
            'Content-Type' = @('application/octet-stream')
            'Content-Length' = @('123')
            'Content-Disposition' = @('attachment; filename="Example.iso"')
        }
    }
}

try {
    $output = & (Join-Path $work 'download.ps1') -ConfigPath $configPath -Destination $destination -CheckOnly 6>&1 | Out-String
    if (Test-Path -LiteralPath $destination) { throw 'Check-only created the destination folder.' }
    if ($global:downloadCalls) { throw 'Check-only downloaded a file.' }
    if ($global:headCalls -ne 1) { throw 'Check-only did not check the Drive file.' }
    if ($output -notmatch '2\.0' -or $output -notmatch '1\.2\.3') { throw 'Check-only did not report both versions.' }
    Write-Host 'Check-only smoke test OK'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

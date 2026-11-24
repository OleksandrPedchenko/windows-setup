$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
Copy-Item -LiteralPath (Join-Path $root 'download.ps1') -Destination (Join-Path $work 'download.ps1')
@{ packages = @(
    @{ name = 'First app'; source = 'winget'; id = 'Example.First' },
    @{ name = 'Second app'; source = 'winget'; id = 'Example.Second' },
    @{ name = 'Third app'; source = 'winget'; id = 'Example.Third' }
) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $work 'packages.json')

function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    $global:selectionPrompts++
    $global:selection
}
function winget {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'show') { 'Version: 1.0'; return }
    if ($args[0] -eq 'download' -and $args[1] -eq '--help') { 'download help'; return }
    throw 'Selection test attempted a download.'
}

try {
    $global:selection = '1,3'
    $global:selectionPrompts = 0
    $output = & (Join-Path $work 'download.ps1') -CheckOnly 6>&1 | Out-String
    if ($global:selectionPrompts -ne 1) { throw 'Package selection was not requested.' }
    if ($output -notmatch 'Checked First app' -or $output -notmatch 'Checked Third app' -or $output -match 'Checked Second app') {
        throw 'Preview did not use the selected packages.'
    }
    $global:selection = '4'
    try {
        & (Join-Path $work 'download.ps1') -Destination (Join-Path $work 'invalid-output')
        throw 'Invalid package number was accepted.'
    } catch {
        if ($_.Exception.Message -notlike '*Invalid package number*') { throw }
    }
    if (Test-Path -LiteralPath (Join-Path $work 'invalid-output')) { throw 'Invalid selection created a destination folder.' }
    Write-Host 'Interactive package selection smoke test OK'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

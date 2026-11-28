$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$scriptText = Get-Content -LiteralPath (Join-Path $root 'drive/Tools/Scripts/download.ps1') -Raw
$global:requestedUrls = @()

function Invoke-RestMethod {
    param([string]$Uri, [switch]$UseBasicParsing)
    $global:requestedUrls += $Uri
    if ($Uri -like '*/packages.json') {
        return @{ packages = @(@{ name = 'Example'; source = 'winget'; id = 'Example.App' }) }
    }
    return @{ format = 'windows-setup-v1'; data = 'encrypted'; tag = 'tag' }
}
function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($AsSecureString) { return [System.Security.SecureString]::new() }
    return ''
}
function winget {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'show') { 'Version: 1.0'; return }
    'download help'
}

$output = & ([scriptblock]::Create($scriptText)) -CheckOnly 6>&1 | Out-String
$base = 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/drive/Tools/Scripts/'
if ($global:requestedUrls.Count -ne 2 -or
    $global:requestedUrls[0] -ne ($base + 'packages.json') -or
    $global:requestedUrls[1] -ne ($base + 'packages.encrypted.json') -or
    $output -notmatch 'Checked Example 1.0') {
    throw 'Remote script invocation did not use the relocated configuration.'
}
Write-Host 'Remote invocation smoke test OK'

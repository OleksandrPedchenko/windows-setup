$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
$plainPath = Join-Path $work 'plain.json'
$encryptedPath = Join-Path $work 'encrypted.json'
@{
    packages = @(@{ name = 'Example ISO'; source = 'google-drive'; id = 'private-example-id'; filename = 'Example.iso'; version = '1.2.3' })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $plainPath

function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    $password = if ($global:wrongPassword) { 'wrong password' } else { 'correct horse battery staple' }
    ConvertTo-SecureString $password -AsPlainText -Force
}
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    [System.IO.File]::WriteAllBytes($OutFile, [byte[]](0, 1, 2, 3))
}
function Invoke-RestMethod {
    param([string]$Uri, [switch]$UseBasicParsing)
    if ($Uri -ne 'https://example.test/packages.encrypted.json') { throw 'Unexpected encrypted config URL.' }
    Get-Content -LiteralPath $global:encryptedFixturePath -Raw | ConvertFrom-Json
}

try {
    & (Join-Path $root 'download.ps1') -EncryptConfig -ConfigPath $plainPath -EncryptedConfigPath $encryptedPath
    if (-not (Test-Path -LiteralPath $encryptedPath)) { throw 'Encrypted config was not created.' }
    if ((Get-Content -LiteralPath $encryptedPath -Raw) -match 'private-example-id') { throw 'File ID appeared in ciphertext.' }
    $global:encryptedFixturePath = $encryptedPath

    $global:wrongPassword = $true
    try {
        & (Join-Path $root 'download.ps1') -EncryptedConfigPath $encryptedPath -Destination (Join-Path $work 'wrong-output')
        throw 'Wrong password was accepted.'
    } catch {
        if ($_.Exception.Message -notlike '*Incorrect passphrase or modified encrypted configuration*') { throw }
    }
    $global:wrongPassword = $false

    $tamperedPath = Join-Path $work 'tampered.json'
    $tampered = Get-Content -LiteralPath $encryptedPath -Raw | ConvertFrom-Json
    $tampered.data = 'x' + $tampered.data.Substring(1)
    $tampered | ConvertTo-Json -Compress | Set-Content -LiteralPath $tamperedPath
    try {
        & (Join-Path $root 'download.ps1') -EncryptedConfigPath $tamperedPath -Destination (Join-Path $work 'tampered-output')
        throw 'Modified ciphertext was accepted.'
    } catch {
        if ($_.Exception.Message -notlike '*Incorrect passphrase or modified encrypted configuration*') { throw }
    }

    & (Join-Path $root 'download.ps1') -EncryptedConfigPath $encryptedPath -Destination (Join-Path $work 'output')
    if (-not (Test-Path -LiteralPath (Join-Path $work 'output/Example.iso'))) { throw 'Decrypted config was not used.' }
    & (Join-Path $root 'download.ps1') -EncryptedConfigPath 'https://example.test/packages.encrypted.json' -Destination (Join-Path $work 'remote-output')
    if (-not (Test-Path -LiteralPath (Join-Path $work 'remote-output/Example.iso'))) { throw 'Remote encrypted config was not used.' }
    Write-Host 'Encrypted configuration smoke test OK'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

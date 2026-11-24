$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
$plainPath = Join-Path $work 'plain.json'
$publicPath = Join-Path $work 'public.json'
$encryptedPath = Join-Path $work 'encrypted.json'
@{
    packages = @(@{ name = 'Example ISO'; source = 'google-drive'; id = 'private-example-id'; filename = 'Example.iso'; version = '1.2.3' })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $plainPath
@{
    packages = @(@{ name = 'Public app'; source = 'winget'; id = 'Example.Public' })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $publicPath

function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($global:skipPrivate) { return [System.Security.SecureString]::new() }
    $password = if ($global:wrongPassword) { 'wrong password' } else { 'correct horse battery staple' }
    ConvertTo-SecureString $password -AsPlainText -Force
}
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [string]$Method, [switch]$UseBasicParsing)
    if ($Method -eq 'Head') {
        $global:driveChecks++
        return [pscustomobject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = 'application/octet-stream'; 'Content-Length' = '123'; 'Content-Disposition' = 'attachment; filename="Example.iso"' } }
    }
    $global:driveRequests++
    [System.IO.File]::WriteAllBytes($OutFile, [byte[]](0, 1, 2, 3))
}
function winget {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'show') { 'Version: 2.0'; return }
    if ($args[0] -eq 'download' -and $args[1] -eq '--help') { 'download help'; return }
    if ($args[0] -eq 'download') {
        $global:wingetDownloads++
        $dir = $args[[array]::IndexOf($args, '--download-directory') + 1]
        Set-Content -LiteralPath (Join-Path $dir 'Public-2.0.exe') -Value 'stub'
    }
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
        & (Join-Path $root 'download.ps1') -ConfigPath $publicPath -EncryptedConfigPath $encryptedPath -Destination (Join-Path $work 'wrong-output')
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
        & (Join-Path $root 'download.ps1') -ConfigPath $publicPath -EncryptedConfigPath $tamperedPath -Destination (Join-Path $work 'tampered-output')
        throw 'Modified ciphertext was accepted.'
    } catch {
        if ($_.Exception.Message -notlike '*Incorrect passphrase or modified encrypted configuration*') { throw }
    }

    $localPreview = & (Join-Path $root 'download.ps1') -ConfigPath $publicPath -EncryptedConfigPath $encryptedPath -CheckOnly 6>&1 | Out-String
    if ($localPreview -notmatch 'Example ISO' -or $localPreview -notmatch 'Public app') { throw 'Decrypted config was not combined with public config.' }
    $remotePreview = & (Join-Path $root 'download.ps1') -ConfigPath $publicPath -EncryptedConfigPath 'https://example.test/packages.encrypted.json' -CheckOnly 6>&1 | Out-String
    if ($remotePreview -notmatch 'Example ISO') { throw 'Remote encrypted config was not used.' }

    Copy-Item -LiteralPath (Join-Path $root 'download.ps1') -Destination (Join-Path $work 'download.ps1')
    Copy-Item -LiteralPath $publicPath -Destination (Join-Path $work 'packages.json')
    Copy-Item -LiteralPath $encryptedPath -Destination (Join-Path $work 'packages.encrypted.json')
    $autoPreview = & (Join-Path $work 'download.ps1') -CheckOnly 6>&1 | Out-String
    if ($autoPreview -notmatch 'Example ISO') { throw 'Nearby encrypted config was not included.' }

    $global:skipPrivate = $true
    $global:driveRequests = 0
    $publicOnly = & (Join-Path $work 'download.ps1') -CheckOnly 6>&1 | Out-String
    if ($publicOnly -notmatch 'Public app' -or $publicOnly -match 'Example ISO') { throw 'Skipping the passphrase included a private package.' }
    if ($global:driveRequests -ne 0) { throw 'Drive was downloaded after skipping the passphrase.' }

    $global:skipPrivate = $false
    $global:wingetDownloads = 0
    $global:driveRequests = 0
    $global:driveChecks = 0
    $preview = & (Join-Path $work 'download.ps1') -CheckOnly -Destination (Join-Path $work 'preview') 6>&1 | Out-String
    if (Test-Path -LiteralPath (Join-Path $work 'preview')) { throw 'Encrypted preview created a download folder.' }
    if ($global:wingetDownloads -ne 0 -or $global:driveRequests -ne 0) { throw 'Encrypted preview downloaded a file.' }
    if ($global:driveChecks -ne 1 -or $preview -notmatch '1\.2\.3' -or $preview -notmatch '2\.0') { throw 'Encrypted preview missed a package.' }

    $global:skipPrivate = $true
    $global:driveChecks = 0
    $publicPreview = & (Join-Path $work 'download.ps1') -CheckOnly -Destination (Join-Path $work 'public-preview') 6>&1 | Out-String
    if ($global:driveChecks -ne 0 -or $publicPreview -match 'Example ISO' -or $publicPreview -notmatch 'Public app') { throw 'Public-only preview included a private package.' }
    if (Test-Path -LiteralPath (Join-Path $work 'public-preview')) { throw 'Public-only preview created a download folder.' }
    Write-Host 'Encrypted configuration smoke test OK'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

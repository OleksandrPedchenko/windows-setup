param(
    [string]$Destination = (Join-Path $(if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }) 'downloads'),
    [ValidateSet('x86', 'x64', 'arm', 'arm64')]
    [string]$Architecture = 'x64',
    [string]$ConfigPath = $(if ($PSScriptRoot) { Join-Path $PSScriptRoot 'packages.json' } else { 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/packages.json' }),
    [string]$EncryptedConfigPath,
    [switch]$EncryptConfig
)

& {
$ErrorActionPreference = 'Stop'

function ConvertFrom-WsSecureString {
    param([System.Security.SecureString]$Value)
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-WsKeys {
    param([string]$Password, [byte[]]$Salt)
    $kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Password, $Salt, 600000)
    try { $bytes = $kdf.GetBytes(64) }
    finally { $kdf.Dispose() }
    $keys = @{
        Encryption = [byte[]]$bytes[0..31]
        Authentication = [byte[]]$bytes[32..63]
    }
    [array]::Clear($bytes, 0, $bytes.Length)
    $keys
}

function Get-WsTag {
    param([byte[]]$Key, [string]$Salt, [string]$Data)
    $hmac = [System.Security.Cryptography.HMACSHA256]::new($Key)
    try { $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("windows-setup-v1`n$Salt`n$Data")) }
    finally { $hmac.Dispose() }
}

try {
    if ($EncryptConfig) {
        if (-not $EncryptedConfigPath -or $ConfigPath -match '^https?://') {
            throw 'Encryption needs a local -ConfigPath and an -EncryptedConfigPath output file.'
        }
        $json = Get-Content -LiteralPath $ConfigPath -Raw
        $null = $json | ConvertFrom-Json
        $first = ConvertFrom-WsSecureString (Read-Host 'New config passphrase' -AsSecureString)
        $second = ConvertFrom-WsSecureString (Read-Host 'Repeat passphrase' -AsSecureString)
        if (-not $first -or $first -cne $second) { throw 'Passphrases do not match or are empty.' }
        $salt = New-Object byte[] 16
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($salt) }
        finally { $random.Dispose() }
        $saltText = [Convert]::ToBase64String($salt)
        $keys = Get-WsKeys $first $salt
        $data = ConvertFrom-SecureString (ConvertTo-SecureString $json -AsPlainText -Force) -Key $keys.Encryption
        $tag = Get-WsTag $keys.Authentication $saltText $data
        $encrypted = [pscustomobject]@{
            format = 'windows-setup-v1'
            salt = $saltText
            data = $data
            tag = [Convert]::ToBase64String($tag)
        }
        $encrypted | ConvertTo-Json -Compress | Set-Content -LiteralPath $EncryptedConfigPath -Encoding UTF8
        Write-Host "Encrypted configuration saved to $EncryptedConfigPath"
        return
    }

    if ($EncryptedConfigPath) {
        if ($EncryptedConfigPath -match '^https?://') {
            $encrypted = Invoke-RestMethod -Uri $EncryptedConfigPath -UseBasicParsing
        } else {
            $encrypted = Get-Content -LiteralPath $EncryptedConfigPath -Raw | ConvertFrom-Json
        }
        if ($encrypted.format -ne 'windows-setup-v1' -or -not $encrypted.data -or -not $encrypted.tag) {
            throw 'Unsupported or incomplete encrypted configuration.'
        }
        $salt = [Convert]::FromBase64String($encrypted.salt)
        $storedTag = [Convert]::FromBase64String($encrypted.tag)
        if ($salt.Length -ne 16 -or $storedTag.Length -ne 32) { throw 'Invalid encrypted configuration.' }
        $password = ConvertFrom-WsSecureString (Read-Host 'Config passphrase' -AsSecureString)
        $keys = Get-WsKeys $password $salt
        $expectedTag = Get-WsTag $keys.Authentication $encrypted.salt $encrypted.data
        $difference = 0
        for ($i = 0; $i -lt 32; $i++) { $difference = $difference -bor ($storedTag[$i] -bxor $expectedTag[$i]) }
        if ($difference -ne 0) { throw 'Incorrect passphrase or modified encrypted configuration.' }
        $secureJson = ConvertTo-SecureString $encrypted.data -Key $keys.Encryption
        $config = ConvertFrom-WsSecureString $secureJson | ConvertFrom-Json
    } elseif ($ConfigPath -match '^https?://') {
        $config = Invoke-RestMethod -Uri $ConfigPath -UseBasicParsing
    } else {
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    }
    if (-not $config.packages -or @($config.packages).Count -eq 0) {
        throw 'packages.json must contain a non-empty packages array.'
    }
    $Destination = [System.IO.Path]::GetFullPath($Destination)
    $null = New-Item -ItemType Directory -Path $Destination -Force
} catch { throw }

$results = @()
foreach ($package in $config.packages) {
    $result = [pscustomobject]@{
        Package = $package.name
        Version = '-'
        Filename = '-'
        Status = 'Failed'
    }
    try {
        if (-not $package.name -or -not $package.id) {
            throw 'Package needs a name and ID.'
        }

        if ($package.source -eq 'winget') {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
                throw 'WinGet is unavailable. Run on Windows with App Installer installed.'
            }
            $null = & winget download --help 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw 'This WinGet version does not support the download command.' }

            $details = & winget show --id $package.id --exact --source winget --architecture $Architecture --accept-source-agreements 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw "WinGet lookup failed: $($details.Trim())" }
            $match = [regex]::Match($details, '(?m)^\s*Version:\s*([^\r\n]+)')
            if (-not $match.Success) { throw 'Could not read the version from WinGet show output.' }
            $version = $match.Groups[1].Value.Trim()

            $before = @{}
            foreach ($file in Get-ChildItem -LiteralPath $Destination -File) {
                $before[$file.FullName] = "$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
            }

            Write-Host "Downloading $($package.name) $version ($Architecture)..."
            $output = & winget download --id $package.id --exact --source winget --version $version --architecture $Architecture --download-directory $Destination --skip-dependencies --accept-source-agreements --accept-package-agreements 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw "WinGet download failed: $($output.Trim())" }

            $files = @(Get-ChildItem -LiteralPath $Destination -File | Where-Object {
                $_.Extension -in @('.exe', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.zip') -and
                ((-not $before.ContainsKey($_.FullName)) -or $before[$_.FullName] -ne "$($_.Length):$($_.LastWriteTimeUtc.Ticks)")
            } | Select-Object -ExpandProperty Name)
            if ($files.Count -eq 0) { throw 'WinGet returned success, but no new or changed installer was found.' }
        } elseif ($package.source -eq 'google-drive') {
            $filename = [string]$package.filename
            if (-not $package.version -or
                -not $filename.EndsWith('.iso', [System.StringComparison]::OrdinalIgnoreCase) -or
                [System.IO.Path]::GetFileName($filename) -ne $filename -or
                $package.id -notmatch '^[A-Za-z0-9_-]+$') {
                throw 'Google Drive entry needs a valid file ID, ISO filename, and version.'
            }
            $version = [string]$package.version
            $url = "https://drive.usercontent.google.com/download?id=$($package.id)&export=download&confirm=t"
            $partial = Join-Path $Destination "$filename.partial"
            try {
                Write-Host "Downloading $($package.name) from Google Drive..."
                Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $partial
                $stream = [System.IO.File]::OpenRead($partial)
                try {
                    $bytes = New-Object byte[] 64
                    $count = $stream.Read($bytes, 0, $bytes.Length)
                } finally { $stream.Close() }
                if ($count -eq 0 -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, $count) -match '^\s*<') {
                    throw 'Google Drive returned an empty file or an HTML page instead of the ISO.'
                }
                Move-Item -LiteralPath $partial -Destination (Join-Path $Destination $filename) -Force
            } finally {
                if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
            }
            $files = @($filename)
        } else {
            throw "Unsupported source: $($package.source)"
        }

        if ($version) { $result.Version = $version }
        $result.Filename = $files -join ', '
        $result.Status = 'Downloaded'
        Write-Host "Downloaded $($package.name) $version`: $($result.Filename)"
    } catch {
        Write-Warning "$($package.name): $_"
    }
    $results += $result
}

Write-Host "`nSummary"
$results | Format-Table -AutoSize | Out-Host
if (@($results | Where-Object Status -eq 'Failed').Count -gt 0) {
    throw 'One or more package downloads failed.'
}
}

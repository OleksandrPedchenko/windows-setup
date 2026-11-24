param(
    [string]$Destination = (Join-Path $(if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }) 'downloads'),
    [ValidateSet('x86', 'x64', 'arm', 'arm64')]
    [string]$Architecture = 'x64',
    [string]$ConfigPath = $(if ($PSScriptRoot) { Join-Path $PSScriptRoot 'packages.json' } else { 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/packages.json' }),
    [string]$EncryptedConfigPath,
    [switch]$EncryptConfig,
    [switch]$CheckOnly
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

function Save-WsDownload {
    param([string]$Url, [string]$Path, [string]$Name)
    $response = [System.Net.WebRequest]::Create($Url).GetResponse()
    $inputStream = $null
    $outputStream = $null
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $bytes = [long]0
    $lastBytes = [long]0
    $lastSeconds = 0.0
    try {
        $inputStream = $response.GetResponseStream()
        $outputStream = [System.IO.File]::Create($Path)
        $buffer = New-Object byte[] 65536
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $outputStream.Write($buffer, 0, $count)
            $bytes += $count
            if ($timer.Elapsed.TotalSeconds - $lastSeconds -ge 1) {
                $seconds = $timer.Elapsed.TotalSeconds
                $speed = ($bytes - $lastBytes) / ($seconds - $lastSeconds) / 1MB
                $percent = 0
                if ($response.ContentLength -gt 0) {
                    $percent = [int][math]::Min(99, 100 * $bytes / $response.ContentLength)
                }
                Write-Progress -Activity "Downloading $Name" -Status ("{0:N2} MiB/s; {1:N1} MiB received" -f $speed, ($bytes / 1MB)) -PercentComplete $percent
                $lastBytes = $bytes
                $lastSeconds = $seconds
            }
        }
    } finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        $response.Dispose()
        Write-Progress -Activity "Downloading $Name" -Completed
    }
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

    if ($ConfigPath -match '^https?://') {
        $config = Invoke-RestMethod -Uri $ConfigPath -UseBasicParsing
    } else {
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    }
    if (-not $config.packages -or @($config.packages).Count -eq 0) {
        throw 'packages.json must contain a non-empty packages array.'
    }

    $autoEncrypted = -not $EncryptedConfigPath
    if ($autoEncrypted) {
        if ($PSScriptRoot) {
            $candidate = Join-Path $PSScriptRoot 'packages.encrypted.json'
            if (Test-Path -LiteralPath $candidate) { $EncryptedConfigPath = $candidate }
        } else {
            $EncryptedConfigPath = 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/packages.encrypted.json'
        }
    }
    if ($EncryptedConfigPath) {
        try {
            if ($EncryptedConfigPath -match '^https?://') {
                $encrypted = Invoke-RestMethod -Uri $EncryptedConfigPath -UseBasicParsing
            } else {
                $encrypted = Get-Content -LiteralPath $EncryptedConfigPath -Raw | ConvertFrom-Json
            }
        } catch {
            if (-not $autoEncrypted -or -not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { throw }
        }
        if ($encrypted) {
            if ($encrypted.format -ne 'windows-setup-v1' -or -not $encrypted.data -or -not $encrypted.tag) {
                throw 'Unsupported or incomplete encrypted configuration.'
            }
            $passphrase = Read-Host 'Private package passphrase (Enter to skip)' -AsSecureString
            if ($passphrase.Length -gt 0) {
                $salt = [Convert]::FromBase64String($encrypted.salt)
                $storedTag = [Convert]::FromBase64String($encrypted.tag)
                if ($salt.Length -ne 16 -or $storedTag.Length -ne 32) { throw 'Invalid encrypted configuration.' }
                $password = ConvertFrom-WsSecureString $passphrase
                $keys = Get-WsKeys $password $salt
                $expectedTag = Get-WsTag $keys.Authentication $encrypted.salt $encrypted.data
                $difference = 0
                for ($i = 0; $i -lt 32; $i++) { $difference = $difference -bor ($storedTag[$i] -bxor $expectedTag[$i]) }
                if ($difference -ne 0) { throw 'Incorrect passphrase or modified encrypted configuration.' }
                $secureJson = ConvertTo-SecureString $encrypted.data -Key $keys.Encryption
                $privateConfig = ConvertFrom-WsSecureString $secureJson | ConvertFrom-Json
                if (-not $privateConfig.packages) { throw 'Encrypted configuration has no packages.' }
                $config.packages = @($config.packages) + @($privateConfig.packages)
            } else {
                Write-Host 'Private packages skipped.'
            }
        }
    }
    $Destination = [System.IO.Path]::GetFullPath($Destination)
    if (-not $CheckOnly) { $null = New-Item -ItemType Directory -Path $Destination -Force }
} catch { throw }

$results = @()
foreach ($package in $config.packages) {
    $downloadTimer = $null
    $result = [pscustomobject]@{
        Package = $package.name
        Version = '-'
        Filename = '-'
        Status = 'Failed'
        Speed = '-'
    }
    try {
        if (-not $package.name) {
            throw 'Package needs a name.'
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

            if ($CheckOnly) {
                $installer = [regex]::Match($details, '(?m)^\s*Installer Url:\s*(https?://\S+)')
                $files = @('-')
                if ($installer.Success) {
                    $files = @([System.IO.Path]::GetFileName(([Uri]$installer.Groups[1].Value).AbsolutePath))
                    Write-Host "Installer URL: $($installer.Groups[1].Value)"
                }
                $hash = [regex]::Match($details, '(?m)^\s*Installer SHA256:\s*([A-Fa-f0-9]{64})')
                if ($hash.Success) { Write-Host "Manifest SHA256: $($hash.Groups[1].Value)" }
            } else {
                $before = @{}
                foreach ($file in Get-ChildItem -LiteralPath $Destination -File) {
                    $before[$file.FullName] = "$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
                }

                Write-Host "Downloading $($package.name) $version ($Architecture)..."
                $downloadTimer = [System.Diagnostics.Stopwatch]::StartNew()
                & winget download --id $package.id --exact --source winget --version $version --architecture $Architecture --download-directory $Destination --skip-dependencies --accept-source-agreements --accept-package-agreements
                $downloadTimer.Stop()
                if ($LASTEXITCODE -ne 0) { throw 'WinGet download failed.' }

                $files = @(Get-ChildItem -LiteralPath $Destination -File | Where-Object {
                    $_.Extension -in @('.exe', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.zip') -and
                    ((-not $before.ContainsKey($_.FullName)) -or $before[$_.FullName] -ne "$($_.Length):$($_.LastWriteTimeUtc.Ticks)")
                } | Select-Object -ExpandProperty Name)
                if ($files.Count -eq 0) { throw 'WinGet returned success, but no new or changed installer was found.' }
            }
        } elseif ($package.source -eq 'utorrent-classic') {
            if ($package.url -ne 'https://download-new.utorrent.com/endpoint/utorrent/os/windows/track/stable') {
                throw 'Unsupported uTorrent Classic URL.'
            }
            $head = Invoke-WebRequest -Uri $package.url -Method Head -UseBasicParsing
            $finalUri = $head.BaseResponse.ResponseUri
            if (-not $finalUri) { $finalUri = $head.BaseResponse.RequestMessage.RequestUri }
            $path = $finalUri.AbsolutePath
            $match = [regex]::Match($path, '^/v2/utclassic/([0-9.]+)/([0-9]+)/windows-installer/official/([a-fA-F0-9]{64})/utorrent_installer\.exe$')
            $sha256 = [string](@($head.Headers['x-amz-meta-sha256'])[0])
            if ($finalUri.Host -ne 'releases.bitmedianetwork.com' -or -not $match.Success -or
                $sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $sha256 -ine $match.Groups[3].Value -or
                [long](@($head.Headers['Content-Length'])[0]) -le 0) {
                throw 'uTorrent Classic did not return expected release metadata.'
            }
            $version = "$($match.Groups[1].Value) build $($match.Groups[2].Value)"
            $filename = "utorrent-$($match.Groups[1].Value)-$($match.Groups[2].Value).exe"
            Write-Host "Installer URL: $($finalUri.AbsoluteUri)"
            Write-Host "Publisher SHA256: $sha256"
            if (-not $CheckOnly) {
                $partial = Join-Path $Destination "$filename.partial"
                try {
                    $downloadTimer = [System.Diagnostics.Stopwatch]::StartNew()
                    Save-WsDownload -Url $finalUri.AbsoluteUri -Path $partial -Name $package.name
                    $downloadTimer.Stop()
                    $actualHash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
                    if ($actualHash -ine $sha256) { throw 'uTorrent Classic installer checksum mismatch.' }
                    Move-Item -LiteralPath $partial -Destination (Join-Path $Destination $filename) -Force
                } finally {
                    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
                }
            }
            $files = @($filename)
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
            if ($CheckOnly) {
                $head = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing
                $contentType = [string](@($head.Headers['Content-Type'])[0])
                $contentLength = [long](@($head.Headers['Content-Length'])[0])
                $disposition = [string](@($head.Headers['Content-Disposition'])[0])
                if ([int]$head.StatusCode -ne 200 -or
                    $contentType -like 'text/html*' -or
                    $contentLength -le 0 -or
                    $disposition -notlike '*attachment*' -or
                    $disposition.IndexOf($filename, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
                    throw 'Google Drive did not return the expected ISO metadata.'
                }
                Write-Host "Drive file size: $contentLength bytes"
            } else {
                $partial = Join-Path $Destination "$filename.partial"
                try {
                    Write-Host "Downloading $($package.name) from Google Drive..."
                    $downloadTimer = [System.Diagnostics.Stopwatch]::StartNew()
                    Save-WsDownload -Url $url -Path $partial -Name $package.name
                    $downloadTimer.Stop()
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
            }
            $files = @($filename)
        } else {
            throw "Unsupported source: $($package.source)"
        }

        if ($version) { $result.Version = $version }
        $result.Filename = $files -join ', '
        if (-not $CheckOnly -and $downloadTimer -and $downloadTimer.Elapsed.TotalSeconds -gt 0) {
            $size = [long]0
            foreach ($file in $files) { $size += (Get-Item -LiteralPath (Join-Path $Destination $file)).Length }
            $result.Speed = '{0:N2} MiB/s' -f ($size / 1MB / $downloadTimer.Elapsed.TotalSeconds)
        }
        if ($CheckOnly) {
            $result.Status = 'Found'
            Write-Host "Checked $($package.name) $version`: $($result.Filename)"
        } else {
            $result.Status = 'Downloaded'
            Write-Host "Downloaded $($package.name) $version`: $($result.Filename) ($($result.Speed) average)"
        }
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

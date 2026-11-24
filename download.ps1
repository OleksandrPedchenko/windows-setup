param(
    [string]$Destination = (Join-Path $PSScriptRoot 'downloads'),
    [ValidateSet('x86', 'x64', 'arm', 'arm64')]
    [string]$Architecture = 'x64',
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'packages.json')
)

$ErrorActionPreference = 'Stop'

try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if (-not $config.packages -or @($config.packages).Count -eq 0) {
        throw 'packages.json must contain a non-empty packages array.'
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'WinGet is unavailable. Run this script on Windows with App Installer installed.'
    }
    $null = & winget download --help 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw 'This WinGet version does not support the download command.'
    }
    $Destination = [System.IO.Path]::GetFullPath($Destination)
    $null = New-Item -ItemType Directory -Path $Destination -Force
} catch {
    Write-Error $_
    exit 1
}

$results = @()
foreach ($package in $config.packages) {
    $result = [pscustomobject]@{
        Package = $package.name
        Version = '-'
        Filename = '-'
        Status = 'Failed'
    }
    try {
        if (-not $package.name -or -not $package.id -or $package.source -ne 'winget') {
            throw 'Package needs a name, a WinGet ID, and source "winget".'
        }

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

        $result.Version = $version
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
if (@($results | Where-Object Status -eq 'Failed').Count -gt 0) { exit 1 }

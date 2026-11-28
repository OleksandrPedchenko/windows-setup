param(
    [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$scripts = @('drive/Tools/Scripts/download.ps1', 'validate.ps1', 'tests/google-drive.ps1', 'tests/encrypted-config.ps1', 'tests/check-only.ps1', 'tests/winget-download.ps1', 'tests/package-selection.ps1', 'tests/remote-invocation.ps1')
$failed = $false

foreach ($name in $scripts) {
    $path = Join-Path $ProjectRoot $name
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Error "Missing script: $path" -ErrorAction Continue
        $failed = $true
        continue
    }
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors.Count) {
        foreach ($error in $errors) { Write-Error "$name`: $error" -ErrorAction Continue }
        $failed = $true
    } else {
        Write-Host "Syntax OK: $name"
    }
}

$configPath = Join-Path $ProjectRoot 'drive/Tools/Scripts/packages.json'
try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $config.packages -or @($config.packages).Count -eq 0) {
        throw 'packages must be a non-empty array'
    }
    foreach ($package in $config.packages) {
        if (-not $package.name -or -not $package.source) {
            throw 'Each package needs name and source'
        }
        if ($package.source -eq 'winget' -and -not $package.id) {
            throw 'WinGet packages need an id'
        }
        if ($package.architecture -and $package.architecture -notin @('x86', 'x64', 'arm', 'arm64')) {
            throw 'Invalid package architecture'
        }
        if ($package.source -eq 'utorrent-classic' -and -not $package.url) {
            throw 'uTorrent Classic needs a URL'
        }
        if ($package.source -eq 'google-drive' -and (-not $package.filename -or -not $package.version)) {
            throw 'Google Drive packages need filename and version'
        }
    }
    Write-Host 'JSON OK: drive/Tools/Scripts/packages.json'
} catch {
    Write-Error "Invalid packages.json: $_" -ErrorAction Continue
    $failed = $true
}

if ($failed) { exit 1 }

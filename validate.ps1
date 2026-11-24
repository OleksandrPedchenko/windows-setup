param(
    [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$scripts = @('download.ps1', 'validate.ps1')
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

$configPath = Join-Path $ProjectRoot 'packages.json'
try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $config.packages -or @($config.packages).Count -eq 0) {
        throw 'packages must be a non-empty array'
    }
    foreach ($package in $config.packages) {
        if (-not $package.name -or -not $package.source -or -not $package.id) {
            throw 'Each package needs name, source, and id'
        }
    }
    Write-Host 'JSON OK: packages.json'
} catch {
    Write-Error "Invalid packages.json: $_" -ErrorAction Continue
    $failed = $true
}

if ($failed) { exit 1 }

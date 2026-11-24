$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work
$configPath = Join-Path $work 'packages.json'
$scriptPath = Join-Path $work 'download.ps1'
$fixturePath = Join-Path $work 'Example.iso'

$socket = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$socket.Start()
$port = $socket.LocalEndpoint.Port
$socket.Stop()
$url = "http://127.0.0.1:$port/Example.iso"
$scriptText = Get-Content -LiteralPath (Join-Path $root 'download.ps1') -Raw
$scriptText = $scriptText.Replace('https://drive.usercontent.google.com/download?id=$($package.id)&export=download&confirm=t', $url)
Set-Content -LiteralPath $scriptPath -Value $scriptText
@{
    packages = @(@{
        name = 'Example ISO'
        source = 'google-drive'
        id = 'example-file-id'
        filename = 'Example.iso'
        version = '1.2.3'
    })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath
[System.IO.File]::WriteAllBytes($fixturePath, [byte[]](0, 1, 2, 3))

$python = (Get-Command python3 -ErrorAction Stop).Source
$server = Start-Process -FilePath $python -ArgumentList @('-m', 'http.server', $port, '--bind', '127.0.0.1', '--directory', $work) -PassThru -RedirectStandardOutput (Join-Path $work 'server.out') -RedirectStandardError (Join-Path $work 'server.err')
try {
    $ready = $false
    for ($i = 0; $i -lt 50; $i++) {
        try {
            $probe = [System.Net.Sockets.TcpClient]::new('127.0.0.1', $port)
            $probe.Dispose()
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { throw 'Local test server did not start.' }

    $output = & $scriptPath -ConfigPath $configPath -Destination (Join-Path $work 'output') 6>&1 | Out-String
    if ($output -notmatch 'MiB/s') { throw 'Download speed was not reported.' }
    if (-not (Test-Path -LiteralPath (Join-Path $work 'output/Example.iso'))) { throw 'The ISO was not saved.' }
    [System.IO.File]::WriteAllText($fixturePath, '<!DOCTYPE html><title>Warning</title>')
    try {
        & $scriptPath -ConfigPath $configPath -Destination (Join-Path $work 'bad-output')
        throw 'An HTML response was incorrectly accepted.'
    } catch {
        if ($_.Exception.Message -eq 'An HTML response was incorrectly accepted.') { throw }
    }
    if (Test-Path -LiteralPath (Join-Path $work 'bad-output/Example.iso')) { throw 'HTML was saved as an ISO.' }
    if (Test-Path -LiteralPath (Join-Path $work 'bad-output/Example.iso.partial')) { throw 'Partial download was not removed.' }
    Write-Host 'Google Drive download smoke test OK'
} finally {
    if (-not $server.HasExited) { $server.Kill() }
    $server.WaitForExit()
    Remove-Item -LiteralPath $work -Recurse -Force
}

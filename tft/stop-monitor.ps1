$ErrorActionPreference='Stop'
$metadata=Join-Path $PSScriptRoot 'data\monitor.json'
$info=Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
$process=Get-Process -Id ([int]$info.pid) -ErrorAction SilentlyContinue
if (-not $process) { Write-Output 'Monitor já está parado.'; exit }
if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$info.startTime).ToUniversalTime().Ticks) { throw 'PID reutilizado ou identidade diferente: nenhum processo foi parado.' }
Stop-Process -InputObject $process
Write-Output 'Monitor TFT parado.'


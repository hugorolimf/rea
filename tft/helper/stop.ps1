# Para o TFT Helper por completo: supervisor, servidor(es) nas portas do helper e overlay.
# -SemPausa: não espera no fim (usado por restart.ps1).
param([switch]$SemPausa)
$ErrorActionPreference = 'SilentlyContinue'
$stopped = @()
# O supervisor primeiro (senão ele sobe o servidor de novo): arquivo de parada e encerramento.
& (Join-Path $PSScriptRoot 'supervisor.ps1') -Parar
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'supervisor.ps1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $stopped += "supervisor (PID $($_.ProcessId))" }
Remove-Item (Join-Path $PSScriptRoot 'supervisor.stop') -ErrorAction SilentlyContinue
# Sem servidor na porta o cmdlet reclama em vez de devolver vazio: silenciado (nada a parar).
foreach ($connection in @(Get-NetTCPConnection -State Listen -LocalPort 3218, 3219, 3220, 3221 -ErrorAction SilentlyContinue)) {
  $process = Get-Process -Id $connection.OwningProcess
  if ($process -and $process.ProcessName -eq 'node') { Stop-Process -Id $process.Id -Force; $stopped += "servidor na porta $($connection.LocalPort) (PID $($process.Id))" }
}
$electron = Join-Path $PSScriptRoot 'overlay\node_modules\electron\dist\electron.exe'
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.ExecutablePath -eq $electron } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $stopped += "overlay (PID $($_.ProcessId))" }
if ($stopped.Count) { 'TFT Helper parado:'; $stopped | ForEach-Object { "  - $_" } } else { 'TFT Helper já estava parado.' }
if (-not $SemPausa) { Start-Sleep -Seconds 2 }

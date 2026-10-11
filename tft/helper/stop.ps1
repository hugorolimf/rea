# Para o TFT Helper por completo: servidor(es) nas portas do helper e o leitor de tela.
$ErrorActionPreference = 'SilentlyContinue'
$stopped = @()
foreach ($connection in Get-NetTCPConnection -State Listen -LocalPort 3218, 3219, 3220, 3221) {
  $process = Get-Process -Id $connection.OwningProcess
  if ($process -and $process.ProcessName -eq 'node') { Stop-Process -Id $process.Id -Force; $stopped += "servidor na porta $($connection.LocalPort) (PID $($process.Id))" }
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'screen-reader\.ps1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $stopped += "leitor de tela (PID $($_.ProcessId))" }
$electron = Join-Path $PSScriptRoot 'overlay\node_modules\electron\dist\electron.exe'
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.ExecutablePath -eq $electron } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $stopped += "overlay (PID $($_.ProcessId))" }
if ($stopped.Count) { 'TFT Helper parado:'; $stopped | ForEach-Object { "  - $_" } } else { 'TFT Helper já estava parado.' }
Start-Sleep -Seconds 2

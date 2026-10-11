# Inicia o TFT Helper em segundo plano (sem janela) e abre a interface no navegador.
$ErrorActionPreference = 'Stop'
$port = 3218
$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if (-not $listening) {
  # Pelo supervisor: se o servidor cair, ele sobe de novo sozinho (supervisor.ps1).
  Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'supervisor.ps1'), '-Port', $port -WorkingDirectory $PSScriptRoot
  foreach ($attempt in 1..40) { Start-Sleep -Milliseconds 250; if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { break } }
}
Start-Process "http://127.0.0.1:$port/"

# Inicia o TFT Helper em segundo plano (sem janela) e abre a interface no navegador.
$ErrorActionPreference = 'Stop'
$port = 3218
$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -WindowStyle Hidden node.exe -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot
  foreach ($attempt in 1..40) { Start-Sleep -Milliseconds 250; if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { break } }
}
Start-Process "http://127.0.0.1:$port/"

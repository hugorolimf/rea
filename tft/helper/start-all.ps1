# Inicia tudo do TFT Helper de uma vez: servidor (se ainda não estiver no ar), overlay (se ainda não estiver aberto)
# e a interface no navegador. Não reinicia nada que já esteja rodando: se o servidor já está na porta, só o aproveita.
# Uso: powershell -NoProfile -File start-all.ps1 [-SemNavegador] [-SemOverlay]
param(
  [switch]$SemNavegador,
  [switch]$SemOverlay
)
$ErrorActionPreference = 'Stop'
$port = 3218
$helper = $PSScriptRoot
$overlayDir = Join-Path $helper 'overlay'
$electron = Join-Path $overlayDir 'node_modules\electron\dist\electron.exe'
$feito = @()

# 1. Servidor
$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listening) {
  $feito += "servidor já estava no ar na porta $port (mantido, sem reiniciar)"
} else {
  Start-Process -WindowStyle Hidden node.exe -ArgumentList 'server.mjs' -WorkingDirectory $helper
  foreach ($attempt in 1..60) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { break }
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { $feito += "servidor iniciado na porta $port" }
  else { $feito += "ATENÇÃO: o servidor não respondeu na porta $port a tempo" }
}

# 2. Overlay (Electron instalado só em overlay\). Uma única instância: se já houver, não abre outra.
if (-not $SemOverlay) {
  if (-not (Test-Path $electron)) {
    $feito += "overlay NÃO iniciado: Electron não está instalado (rode 'npm install' em $overlayDir)"
  } else {
    $ativo = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $electron }
    if ($ativo) {
      $feito += 'overlay já estava aberto (mantido)'
    } else {
      Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $overlayDir
      $feito += 'overlay iniciado (Ctrl+Shift+F9 mostra/esconde, F10 interativo, F11 ancora no monitor do TFT, F12 sai)'
    }
  }
}

# 3. Interface no navegador
if (-not $SemNavegador) { Start-Process "http://127.0.0.1:$port/"; $feito += 'interface aberta no navegador' }

$feito | ForEach-Object { "  - $_" }

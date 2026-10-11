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

# 0. Meta offline (extensão MetaTFT): sincroniza as cópias locais ANTES de subir o servidor, com teto curto. Nunca bloqueia
# nem impede o início: sem rede, o servidor segue com a cópia local (ou com o snapshot do repositório). Com o servidor já no
# ar, ele mesmo renova em segundo plano e a sincronização do atalho é dispensada.
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
  $feito += 'meta: servidor já no ar renova sozinho em segundo plano (sincronização do atalho dispensada)'
} else {
  $saida = Join-Path ([IO.Path]::GetTempPath()) "tft-meta-sync-$PID.txt"
  try {
    $sync = Start-Process node.exe -ArgumentList 'scripts/meta-sync.mjs', '--timeout=12000' -WorkingDirectory $helper -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida
    if ($sync.WaitForExit(18000)) {
      $linha = Get-Content $saida -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_ } | Select-Object -Last 1
      if (-not $linha) { $linha = 'meta sem resposta da sincronização: segue com a cópia local' }
    } else {
      try { $sync.Kill() } catch {}
      $linha = 'meta não sincronizada a tempo: segue com a cópia local'
    }
  } catch {
    $linha = "meta não sincronizada ($($_.Exception.Message)): segue com a cópia local"
  } finally {
    Remove-Item $saida -ErrorAction SilentlyContinue
  }
  $feito += $linha
}

# 1. Servidor
$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listening) {
  $feito += "servidor já estava no ar na porta $port (mantido, sem reiniciar)"
} else {
  # Pelo supervisor (supervisor.ps1): se o servidor cair, ele sobe de novo sozinho. stop.ps1 encerra os dois.
  Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $helper 'supervisor.ps1'), '-Port', $port -WorkingDirectory $helper
  foreach ($attempt in 1..60) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { break }
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { $feito += "servidor iniciado na porta $port" }
  else { $feito += "ATENÇÃO: o servidor não respondeu na porta $port a tempo (o supervisor segue tentando; veja supervisor.log)" }
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

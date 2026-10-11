# Supervisor do servidor do TFT Helper: mantém o server.mjs de pé. Se o processo morrer (queda, memória, erro fatal), sobe
# de novo com espera crescente curta (2, 4, 8... até 30 s; volta a 2 s depois de um minuto estável), sem laço frenético.
# NÃO reinicia nem encerra um servidor que já esteja na porta: nesse caso só espera (a instância de fora segue como está).
# Para parar de propósito: stop.ps1 (ou `supervisor.ps1 -Parar`), que cria o arquivo supervisor.stop e encerra o supervisor.
# Registro: supervisor.log (rotaciona em 256 KB). Saúde do servidor: GET http://127.0.0.1:<porta>/api/health.
# Opção para iniciar com o Windows (NÃO é registrada por este projeto; faça só se quiser): atalho na pasta Inicializar
# (shell:startup) chamando
#   powershell -NoProfile -WindowStyle Hidden -File "<esta pasta>\supervisor.ps1"
param(
  [int]$Port = 3218,
  [switch]$Parar
)
$ErrorActionPreference = 'Continue'
$helper = $PSScriptRoot
$stopFile = Join-Path $helper 'supervisor.stop'
$log = Join-Path $helper 'supervisor.log'
if ($Parar) { Set-Content -Path $stopFile -Value (Get-Date -Format o); return }
Remove-Item $stopFile -ErrorAction SilentlyContinue

function Write-Log([string]$text) {
  try {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 262144) { Move-Item $log "$log.1" -Force }
    Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format o), $text)
  } catch {}
}
function Test-PortInUse { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }

Write-Log "supervisor iniciado (PID $PID, porta $Port)"
$espera = 2
while (-not (Test-Path $stopFile)) {
  if (Test-PortInUse) { Start-Sleep -Seconds 5; continue }   # já há um servidor na porta: não mexe
  $inicio = Get-Date
  $env:TFT_HELPER_PORT = "$Port"
  $p = Start-Process -FilePath node.exe -ArgumentList 'server.mjs' -WorkingDirectory $helper -WindowStyle Hidden -PassThru
  Write-Log "servidor iniciado (PID $($p.Id))"
  while (-not $p.HasExited -and -not (Test-Path $stopFile)) { Start-Sleep -Seconds 2 }
  if (Test-Path $stopFile) {
    if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch {} }
    break
  }
  $vivo = ((Get-Date) - $inicio).TotalSeconds
  Write-Log ("servidor saiu (código {0}) depois de {1:N0} s; sobe de novo em {2} s" -f $p.ExitCode, $vivo, $espera)
  Start-Sleep -Seconds $espera
  $espera = if ($vivo -ge 60) { 2 } else { [Math]::Min(30, $espera * 2) }
}
Write-Log "supervisor encerrado"
Remove-Item $stopFile -ErrorAction SilentlyContinue

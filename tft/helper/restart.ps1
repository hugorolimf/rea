# Atualiza o TFT Helper inteiro (atalho "TFT Helper - Atualizar"): para tudo (supervisor, servidor e overlay, stop.ps1),
# baixa a meta de novo (MetaTFT, mesmo com a cópia local recente: os dados que o código novo lê), sobe o servidor e o
# overlay e reabre a interface no navegador (start-all.ps1 -ForcarMeta). Sem rede, segue com a cópia local.
$ErrorActionPreference = 'Continue'
$helper = $PSScriptRoot
$port = 3218
$electron = Join-Path $helper 'overlay\node_modules\electron\dist\electron.exe'

'Atualizando o TFT Helper (meta, servidor, overlay e interface)...'
& (Join-Path $helper 'stop.ps1') -SemPausa

# Espera o que foi encerrado sair de fato (porta livre, overlay fechado); senão o start-all acharia que ainda está no ar.
foreach ($i in 1..50) {
  $porta = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  $overlay = Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron }
  if (-not $porta -and -not $overlay) { break }
  Start-Sleep -Milliseconds 100
}

try {
  & (Join-Path $helper 'start-all.ps1') -ForcarMeta
} catch {
  "ERRO ao iniciar: $($_.Exception.Message)"
}

if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
  'Pronto: servidor, overlay e interface atualizados.'
  Start-Sleep -Milliseconds 1500
} else {
  'O servidor NÃO subiu (talvez erro no código novo). Veja server.log e supervisor.log, ou rode "node server.mjs" nesta pasta.'
  Read-Host 'Enter para fechar'
}

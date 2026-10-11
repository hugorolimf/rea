# Otimizar os fluxos de análise

Pedido do usuário (2026-10-11): "depois você pode pensar como otimizar os fluxos de análise também, é interessante fazer isso."

Estado: **a fazer**. Esperar terminarem os agentes que editam o motor e a análise (itens-central, comp-viabilidade,
aprimoramentos, remover-ocr), porque medir com o código pela metade dá números enganosos. Executor previsto: `tft-desempenho`,
primeiro só com plano.

## Pontos de partida já medidos

Medidos pelo `tft-overlay` em `planos/a-fazer/PLANO-OVERLAY-RAPIDO.md` (seção 1):

- O tick automático de 3 s espera a análise terminar antes de reler o estado. A análise leva cerca de 2 s na mediana e
  cerca de 9 s no pior caso comum, e nesse tempo ouro, nível e loja ficam parados (um estado chegou a ter 11,9 s de idade).
- A cada mudança o overlay baixa a resposta inteira, de 0,9 a 1,1 MB, e 70% disso é o `compRanking`, do qual o
  overlay usa uma entrada só.
- Cada leitura do `gep-reader.mjs` leva cerca de 146 ms (até 496 ms) e bloqueia o servidor.
- Com a remoção do OCR (`planos/em-andamento/PLANO-REMOVER-OCR.md`), caem as esperas de estabilização, a retenção de 15 s e a
  histerese de troca entre GEP e tela.

Histórico do que já foi feito: `planos/feitos/lentidao-ao-vivo.md` (P1–P6) e `ARQUITETURA.md` (M8 grafo de fatos, M10b worker).

## Pendências de servidor

### SSE que cubra o estado e a análise (pedido da interface web, 2026-10-11)

Pedido do usuário: "A interface web deve se manter ativa. Mesmo que a tela não esteja presente, os dados devem vir do lado
do servidor. A interface só puxa, mas deve continuar puxando." A interface agora busca também com a aba oculta
(`v2/js/live-loop.js`) e usa o SSE como gatilho principal, porque o navegador espaça os temporizadores de abas ocultas
(1 s no mínimo; depois de 5 min, cadeias de temporizadores a cerca de 1 por minuto) mas entrega eventos de rede.

Hoje `/api/events` (`capture.mjs` `subscribe`/`broadcast`, `server.mjs`) emite só:

- `boards`: quando muda o arquivo de tabuleiros do jogo (em geral na troca de rodada);
- `match`: início, fim, reabertura e registro da partida;
- `meta`: nova cópia das comps de meta.

Não emite nada quando muda só o estado do GEP (ouro, nível/XP, loja, banco de campeões e de itens, oferta e escolha de
aprimoramentos), nem quando o laço automático (`app/auto-refresh.mjs`) termina uma análise nova. Para isso a página
depende do temporizador de reserva de 5 s, que em segundo plano o navegador pode atrasar.

Pedido (exige reiniciar o servidor, por isso não foi feito agora):

1. Emitir um evento leve (por exemplo `{ type: "state", key, at }`, sem o corpo do estado) quando a chave de análise
   (`core/state/analysis-key.mjs`) ou o resumo do GEP mudar, com debounce de ~250 ms. O laço automático já calcula essa
   chave a cada tick.
2. Emitir `{ type: "analysis", key }` quando o laço automático terminar uma análise, para a tela buscar o resultado já
   pronto (o POST com a mesma chave divide o cálculo).
3. Manter o heartbeat de 15 s. A interface já trata qualquer evento como gatilho (`loop.kick()` em `v2/js/main.js`) e
   ignora tipos desconhecidos, então a mudança é compatível sem alterar o cliente; o overlay (`overlay/hud/`) pode
   ignorar os tipos novos.

Validação: com a aba oculta por mais de 5 min durante uma partida, a idade do dado na volta (barra de conexão) deve ficar
abaixo de alguns segundos.

### Peças na reserva separadas das em campo (pedido da interface web, 2026-10-11)

Pedido do usuário: "Na interface, ajuste para mostrar que eu tenho a peça no banco; atualmente só mostra as que estão em
campo." A interface resolveu isso sozinha, sem mudar o servidor: a regra única `v2/js/roster.js` (`rosterOf`,
`ownership`, `compOwnership`) junta `rec.self.units` (campo) com `state.screen.gepBench` (reserva, só com
`screen.sources.bench === "gep"`; sem GEP a reserva é desconhecida) e calcula no cliente o "N/M em campo · +K na reserva"
dos cartões da aba Comps, do modal e do anel do HUD.

O que o servidor ainda mistura (exige reiniciar, por isso não foi feito agora):

1. `stage.goalProgress.onBoard` (`stage.mjs`) conta as peças da meta que você tem em campo **ou na reserva** (`have(id)`
   olha `analysis.self.units` e `analysis.self.reserve`) e corta no nível (`ownedGoal.slice(0, level)`). O nome e o uso
   ("peças em campo") dizem outra coisa. Proposta: `goalProgress: { onBoard, inReserve, goal }`, com `onBoard` só do
   campo e `inReserve` as peças da meta que estão só na reserva.
2. `compRanking[].owned` (`engine.mjs`, `owned: r.board.filter((c) => own.has(key(c))).length`) também soma campo e
   reserva (`own` recebe `options.bench`). Proposta: `ownedField` e `ownedReserve` ao lado de `owned`, para quem não tem
   o estado do GEP (overlay, histórico) não precisar refazer a conta.
3. `recommendations[].board[].owned` é verdadeiro também para peça só na reserva (`inReserve` diz qual). A interface já
   olha `inReserve` antes de `owned`; um campo `where: "field" | "reserve" | "both"` evitaria a armadilha.
4. O overlay (`overlay/hud/view.mjs`, `onBoard: model.plan.progress`) mostra "N/M peças em campo" com o par do modelo, que
   agora é só do campo; o "+K na reserva" está em `model.plan.reserve` e o overlay ainda não o desenha.

Validação: com uma peça da comp só na reserva (GEP ativo), `goalProgress.onBoard` não a conta e `inReserve` = 1; a
interface e o overlay mostram "N/M em campo · +1 na reserva" sem cálculo próprio.

### Atraso do event loop derrubando o overlay (2026-10-11)

Relato do usuário: "o overlay tem que ficar estável durante a partida; vez ou outra ele cai". O `server.log` (TEMPO carga,
20:54–20:58, em partida) mostra loop-lag p99 de 0,6 a 1,5 s e máximo de 2,6 a 3,7 s. A sonda do overlay tinha limite de
2,5 s, então cada pico virava "servidor offline" e troca de página. O lado do overlay (histerese, sem trocar a página, sem
recarga em partida) está com o `tft-overlay`. Do lado do servidor, falta achar o que bloqueia o loop por segundos (leitura do
GEP ~146 ms por chamada, gravações, montagem da resposta de ~1 MB) e tirá-lo do caminho crítico, com meta de p99 < 200 ms.

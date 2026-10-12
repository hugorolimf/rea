# Overlay do TFT helper

Janela transparente, sempre no topo e click-through que mostra sobre o jogo o que a interface web (`v2/`) já mostra. Tem dois modos:

- **Integrado** (padrão): a janela cobre exatamente a área cliente da janela do TFT e desenha realces, etiquetas e dicas **ancorados nos elementos do próprio jogo** (slots da loja, banco de itens, ouro, nível/XP, estágio), mais cartões posicionáveis e redimensionáveis (como os 8 elementos do TFTAcademy), um painel de ajuda (`?`) e um modo de calibração.
- **Painel** (fase 1): uma janelinha com os cartões em coluna, arrastável e redimensionável.

É uma janela comum de outro processo. Não há injeção no jogo, hook, leitura de memória, captura de tela nem automação de entrada. **O overlay só mostra; nunca clica nem digita por você.** Ele não decide nada: o veredito de rolagem, o próximo item, o plano, a compra na loja e os Wisps vêm prontos do servidor.

## Isolamento

Este diretório é um pacote próprio (`overlay/package.json`) com uma única dependência, o `electron` oficial, fixado em `44.7.0`. O servidor e a interface web seguem sem dependências, e o `package.json` e o lockfile da raiz do repositório não são tocados. `node_modules/`, `overlay.config.json` e `overlay.log` ficam fora do Git (`tft/.gitignore`).

## Instalar e iniciar

```
cd tft/helper/overlay
npm install      # uma vez; baixa o Electron (~100 MB) só aqui dentro
npm start        # electron .
```

Antes, o servidor do helper precisa estar rodando (`node server.mjs` em `tft/helper`, porta 3218 ou `TFT_HELPER_PORT`). A página do HUD e os módulos novos são servidos do disco a cada pedido, então não é preciso reiniciar um servidor que já conhece `/api/overlay` e `/overlay/`; um servidor mais antigo que isso precisa ser reiniciado.

O overlay nunca encerra por causa do servidor, e uma lentidão do servidor não derruba o HUD (`probe.mjs`): a sonda (a cada ~3 s, limite de 6 s) separa **porta fechada** (fora do ar na hora) de **tempo esgotado** (servidor vivo e ocupado: só conta como fora do ar depois de 3 falhas seguidas). Com o HUD já carregado a página **nunca é trocada**: ela fica com os últimos dados e mostra o selo "sem resposta do servidor há N s"; a primeira resposta boa volta ao normal sem recarregar. O aviso `offline.html` só aparece quando o HUD ainda não carregou (por exemplo, o overlay abriu antes do servidor).

## Atalhos globais

Padrão (configuráveis em `overlay.config.json`; usam teclas de função porque Ctrl+Alt equivale ao AltGr em teclados como o ABNT2):

| Atalho              | Ícone | Ação                                                                                       |
| ------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `Control+Shift+F9`  | ◐     | mostrar/esconder                                                                           |
| `Control+Shift+F10` | ✥     | modo de edição (arrastar e redimensionar os blocos; `Esc` ou o mesmo atalho volta ao jogo) |
| `Control+Shift+F6`  | ⧉     | copiar o código da comp recomendada (cole no Planejador do jogo)                           |
| `Control+Shift+F5`  | ▦     | mostrar/esconder o painel da comp (peças, quem está em campo, builds e sinergias)          |
| `Control+Shift+F3`  | ◂     | comp anterior no painel (plano e sugeridas; não fixa nada)                                 |
| `Control+Shift+F4`  | ▸     | próxima comp no painel (plano e sugeridas; não fixa nada)                                  |
| `Control+Shift+F8`  | ?     | abrir/fechar a ajuda (liga o modo de edição junto)                                         |
| `Control+Shift+F7`  | ⌖     | abrir/fechar a calibração (liga o modo de edição junto)                                    |
| `Control+Shift+F11` | ⌕     | integrado: procura a janela do jogo de novo; painel: ancora ao monitor do TFT              |
| `Control+Shift+F12` | ✕     | sair                                                                                       |

F3, F4 e F5 com Ctrl+Shift foram escolhidas por estarem livres: ficam ao lado das existentes (F6 a F12), o TFT não usa Ctrl+Shift com teclas de função e programas comuns (Discord, AMD/NVIDIA, Windows) não as tomam. Se você der a tecla padrão de uma ação a outra (por exemplo `toggle` em F5), a ação que perdeu a tecla fica **sem atalho** ("—" na legenda, "sem atalho" na ajuda e uma linha no log), em vez de repetir uma tecla que o registro recusaria.

A lista de atalhos tem **uma fonte só**: `hud/hotkeys.mjs` (id, tecla padrão, rótulo, texto curto e ícone). O processo principal registra percorrendo essa lista e manda à página o resultado de cada registro (`mode.shortcuts`); a legenda sobre o jogo e a ajuda só apresentam essa lista, sem escrever teclas. Se um atalho já estiver em uso por outro programa, o registro falha: ele aparece **marcado** (✖, em vermelho) na legenda e na ajuda, e a linha `atalhos registrados: ... (FALHOU)` vai ao `overlay.log`.

### Legenda de atalhos e "Copiar comp" (elemento `keys`)

Um bloco pequeno à direita da loja (x 0,82, y 0,745 do HUD 16:9: abaixo da lista de jogadores, que é estimada, e longe do centro, onde ficam as cartas de aprimoramento e o carrossel), com:

- o botão **⧉ Copiar comp** ("⧉ Copiar" na verbosidade mínima), que copia `plan.teamCode` da comp exibida (o mesmo código do botão da interface web; vem no `/api/overlay` que o overlay já recebe). A cópia é feita pelo processo principal (`clipboard` do Electron), porque a janela não é focável; o código só é gravado se tiver o formato do planejador (`isTeamCode`). Depois de copiar aparece "Copiado: cole no Planejador" por 1,5 s. Sem código o botão fica apagado e o clique (ou `Ctrl+Shift+F6`) mostra o motivo por 2 s (o erro do servidor, por exemplo "Campeão sem ID de importação confirmado", ou "Sem comp sugerida agora");
- o botão **⌨**, que recolhe ou abre a legenda (a escolha fica em `layout.keys.folded`);
- a legenda: na verbosidade normal (padrão) cada atalho com a tecla, o ícone e o rótulo curto, em duas colunas (`Ctrl+Shift`+ · F9 ◐ Mostrar/ocultar · F10 ✥ Editar · F6 ⧉ Copiar comp · F5 ▦ Ver comp · ...); na mínima só teclas e ícones, com o significado na dica do mouse e no `?`.

Na primeira exibição a legenda fica aberta por 20 s e depois se recolhe sozinha (`layout.keys.seen`); dali em diante vale o que você escolher.

Os dois botões são as únicas partes clicáveis **fora** do modo de edição: o processo principal confere a posição **real** do cursor (`screen.getCursorScreenPoint`, a cada 100 ms, só com o overlay visível e alguma região declarada) e só enquanto ele está sobre um deles tira o click-through; fora disso, todo clique vai para o jogo. Nada é digitado nem colado no jogo: você abre o Planejador e cola.

## Modo integrado

### Como se ancora ao jogo

Um PowerShell **persistente e somente-leitura** (`game-tracker.mjs`) lê a cada ~750 ms (a cada 120 ms enquanto a janela está mudando; ver "Adaptação ao tamanho do jogo") a posição da área cliente da janela do TFT (classe `UnrealWindow`, título começando por "TFT", visível e não minimizada) com `EnumWindows`, `GetClientRect` e `ClientToScreen`. Nada além de posição. O Electron coloca a janela transparente exatamente sobre essa área (convertida para DIP) e acompanha se o jogo mudar de lugar ou de tamanho. Sem o jogo, a janela cobre o monitor, as âncoras somem e os cartões continuam (o indicador de saúde do dock avisa "Janela do TFT não encontrada").

O HUD do TFT é 16:9 e escala sem esticar. O retângulo 16:9 e as frações das regiões (loja, banco de itens, ouro, nível, XP, estágio) ficam num módulo único (`hud/geometry.mjs`); são só onde o overlay desenha as âncoras, nada é lido da tela. `tests/overlay-geometry.test.mjs` fixa os valores literais, para que uma mudança neles seja deliberada. (As frações vieram da antiga leitura de tela, removida em 2026-10-11; ver `../.old/ocr/README.md`.)

### O que aparece sobre o jogo

Cada dica tem categoria, prioridade, âncora, texto curto, ícone e ação sugerida (`hud/hints.mjs`). Todas derivam de campos que o servidor já entrega:

| Categoria                        | Exemplos                                                                                                                                                                                                                                                                  | Âncora         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| compra (`buy`)                   | "Compre Veigar" com contorno pulsante no slot da loja (tracejado e "?" se a loja do GEP é só provável, com a fonte parada); peça do plano que você já tem vale igual, com o que a cópia fecha: "Compre Varus (cópia · fecha o 2★)" ou "(cópia · sobe para 3★ (faltam 4))" | slot da loja   |
| itens (`items`)                  | "Passe X de A para B", "Equipe X em Y", "Monte X com A+B"                                                                                                                                                                                                                 | banco de itens |
| ouro/rolagem (`gold`)            | "Role até Ng, pare em Mg", "Vale esperar o nível N", "Suba de nível (Ng)", marca de juros, selo do nível                                                                                                                                                                  | ouro, nível    |
| Wisps (`wisp`)                   | "Wisp X: comprar/avaliar/pular" com o motivo do servidor                                                                                                                                                                                                                  | slot da loja   |
| aprendizado (`learn`, desligada) | o porquê, só com textos do servidor (economia, nível, rolagem)                                                                                                                                                                                                            | ouro, nível    |
| alerta                           | perigo de vida (valor `pressure` do servidor); nunca é desligável                                                                                                                                                                                                         | ouro           |

**Compra de peça que você já tem.** A lista "Comprar" do servidor só traz peças que faltam; o modelo (`v2/js/model.js`, regra em `core/pool/buy-copies.mjs`) acrescenta, para cada peça do plano que está em campo ou na reserva e ainda não é 3★, uma linha de **cópia** que só aparece enquanto a loja a mostra (espaço ancorado, mesmo `Compre`). A cópia que fecha estrela (2★/3★) vem antes do carry, que vem antes das demais; sem ouro a dica vira âmbar; peça 3★ ou sem as cópias que faltam na pool não gera aviso; loja ilegível não gera aviso nenhum.

**Itens por campeão.** O cartão `items` ("Itens: próximo, por campeão e movimentos") lista o "Próximo item" (destaque, com a receita) e, abaixo, "Itens dos campeões": cada campeão em campo com slot livre e item pendente (o carry primeiro, até 4; o resto vira "+N campeões") com **todos** os até 3 itens ideais, na ordem da build, cada um como ícone com marca e palavra curta segundo o seu banco: `equipado`, `no banco`, `monta agora`, `mover` (com o retrato de quem o tem) ou `falta N`; o próximo a resolver ganha contorno. É a mesma conta da janela de itens da Formação (`core/items/champion-items.mjs`). O widget `builds` ("Itens da formação", oculto por padrão) continua existindo com a lista completa, inclusive o que já está equipado.

A verbosidade controla o teto e a prioridade mínima (`minimal`: 3 dicas importantes; `normal`: até 5; `detailed`: até 8, com o porquê junto). Dicas sem alvo geométrico aparecem só na lista "Dicas". Dados velhos (leitura ou análise antigas) esmaecem e perdem o pulso.

**Tela padrão (verbosidade normal).** O padrão voltou a ser a tela de antes, com as melhorias: etiquetas com a ação e o motivo curto ("Compre X", "Role até 30g" + "pare em 24g"), o alerta de vida com o número ao lado ("❤ 28 · Vida em perigo"), o cartão de itens com cabeçalhos, os cartões de carrossel e de aprimoramento com cabeçalho, o dock com o estado do modo e a legenda de atalhos com rótulos. Fora do que o usuário pediu tirar da tela padrão:

- a **faixa de estado** (`bar`), a **lista de dicas** sem alvo (`hints`) e o **cartão "Vale rolar?"** (`roll`) começam ocultos (religáveis no `?`): ouro, nível e rolagem viraram selos sobre o próprio HUD do jogo (abaixo). Os avisos discretos da faixa (servidor sem resposta há N s, leitura ou análise velha, outro jogo) passam ao dock enquanto ela está oculta; a mensagem dos estados sem plano ("aguardando análise", "Partida encerrada") mora com o dock;
- as marcas ancoradas (compra na loja, itens no banco) continuam; as de ouro/nível saem da marca quando os selos dos botões estão na tela, para não repetir.

**Verbosidade mínima (opção do `?`).** Para quem quer leitura de relance: ícones, retratos e números no lugar de frases, com a frase inteira na dica do mouse (modo de edição). `tests/overlay-hud.test.mjs` limita o texto visível SÓ nessa verbosidade (nenhuma linha acima de 24 caracteres) e tem um teste próprio de que a normal mostra o conteúdo completo.

**Migração da configuração (padrões v3 e v4).** Ao iniciar, `loadAndMigrateConfig` faz backup (`overlay.config.json.bak-AAAAMMDD-HHMMSS`) e registra no `overlay.log` ("configuração migrada para os padrões vN ..."):

- v2 -> v3: `hints.verbosity` volta de `"minimal"` para `"normal"` **só** se foi a migração v1 -> v2 que gravou o `"minimal"` (prova: um backup da v1 ao lado cuja verbosidade não era uma escolha de `"minimal"` ou `"detailed"`); uma escolha manual nunca é tocada;
- v3 -> v4: `bar`, `hints` e `roll` passam a `hidden: true` só se ainda estavam com o padrão antigo do campo (`hidden: false`); a posição salva fica.

Rodar de novo não muda nada (o arquivo já está na v4).

### Selos nos botões do jogo (`hud/badges.mjs`)

Durante a partida ao vivo, sobre o próprio HUD do TFT (posições `[ESTIMADO]` em `geometry.mjs`, `SHOP_BUTTONS`, ajustáveis pela calibração `F7` junto com o resto; marcadas nas zonas ocupadas):

- **botão Atualizar (reroll)**: o veredito de rolagem na cor dele: "↻ role até 30g", "↻ não role", "↻ espere o nível 8", "↻ sem peça viável". Quando é para rolar, diz **por quem**: os retratos dos alvos (até 3, o primeiro em destaque, com a estrela-alvo) e o orçamento ("↻ [Kayle 3★] [Azir 2★] até 30g"). A dica lista cada alvo com a chance com o orçamento, as cópias (4/9), os rivais e o motivo. Fonte: `strategy.panels.rolling.rollFor` (tft-rolagem); sem ele, `call.targets`; sem ele, a lista de rolagem que o servidor já mandava (`rolling.targets`). Uma carta de alvo na loja ganha "achou: Kayle" sobre o cartão;
- **botão Comprar XP**: "↑ suba agora · 4g" ou "↑ espere 4-1 · 8g" (o estágio em que a curva padrão, `POLICY.curve`, chega ao próximo nível), ou "↑ não suba" no nível final da comp;
- **ao lado do ouro**: "⚑ 50g", o ouro a ter guardado agora (o piso da decisão, `economy.keep`, ou o da faixa de vida, `economy.floor`), verde no piso ou acima e âmbar abaixo; a dica diz o motivo ("juros: 50g dá +5", "vida em perigo: gaste até 10g").

A explicação de cada selo vai na dica do mouse (modo de edição) e na seção "Selos nos botões do jogo" do `?`.

### Painel da comp (`hud/comp.mjs`, atalhos F5 / F3 / F4)

`Ctrl+Shift+F5` mostra ou esconde, sobre o jogo, a comp atual: as peças do plano (retrato, estrela, coroa no carry), onde cada uma está (✓ em campo, reserva, + falta), as builds de "Builds e 3★" (o motor único `core/items/builds.mjs`, com o item equipado contornado), os 3★ e as sinergias ativas. `Ctrl+Shift+F3`/`F4` passam pela comp do plano e pelas sugeridas da mesma análise ("Plano", "Sugerida 1", ...), sem fixar nada. Quando a peça em uso numa vaga não é a da comp, a casa mostra o retrato do substituto em destaque, o da original pequeno no canto (esmaecido, com o contorno da cor do custo) e o selo ⇄; a dica diz "Varus 2★ no lugar de Aphelios (temporário: volta quando Aphelios chegar a 2★)" ou "troca da comp: S no lugar de T". A peça do plano na sua loja ganha moeda + custo e "na sua loja (slot N): compre para a vaga de X". Fonte: o modelo por vaga `stage.slots` (`core/board/interim.mjs`); sem ele, as trocas aceitas (`autoSwaps`/`goal.swaps`), as trocas propostas (`transitions`) e a lista Comprar cruzada com a loja. O painel não captura o mouse fora do modo de edição e some com o mesmo atalho.

### Entra e sai (`hud/swaps.mjs`, elemento `swaps`)

Um bloco próprio do overlay (posicionável como os outros; padrão na coluna da direita, no lugar do antigo "Vale rolar?", longe da loja, dos aprimoramentos e do carrossel) com as trocas de agora, em ordem: "[Kog'Maw 2★] → [Aphelios] entra (da reserva)", "[Kayle] ↓ sai para a reserva", "$ vender [X]", "[$1 Rakan da loja] → vaga de [Brambleback]" e os temporários com ⇄ (a volta na dica). Nada é desenhado sobre o tabuleiro ou a reserva do jogo. Fonte: `stage.slots` e `stage.interim.buys[].sell`; sem eles, `transitions` (prontas = entra/sai; não prontas = temporário).

**Substituto na loja.** O substituto temporário que o modelo manda comprar (`kind: "temporario"`, `playing.source: "loja"`, `buy.slot`) ganha na carta da loja "⇄ Compre X (temporário)" em violeta, com "no lugar de Aphelios" e a volta na dica; se a mesma carta também é peça da comp, vale a marca da comp.

### Montar agora (cartão de itens)

No topo do cartão de itens, o que montar AGORA para a comp do plano (como a página web): "[item] = [componente]+[componente] → [campeão]", "pronto: [item] → [campeão]", "segure [item] em [temporário] → para [titular]" e "falta [componente] para [item] [campeão]". O carry primeiro, até 3 linhas; o resto na dica do mouse. Fonte: as linhas "Itens dos campeões" do modelo (só peças da comp, core/items) e `stage.bankItems` (core/items/scenarios.mjs); a receita vem de `nextItemRecipe` com o banco lido. O carrossel mostra só o ícone de cada item (a recomendada marcada, a ordem e a receita); o campeão que traz o item fica só na dica do mouse.

### Elementos posicionáveis

Onze elementos (`dock`, `bar`, `hints`, `roll`, `items`, `builds`, `plan`, `carousel`, `keys` (a legenda de atalhos com "Copiar comp"), `comp` (o painel da comp) e `swaps` ("Entra e sai")), com posição e largura em fração do **retângulo 16:9 do HUD** (igual à tela inteira numa janela 16:9), mantidos dentro das bordas (margem de 0,75%, como o TFTAcademy). `builds`, `plan`, `bar` (faixa de estado), `hints` (lista de dicas) e `roll` (cartão "Vale rolar?") começam ocultos e se religam no `?`. No modo de edição (`F10`) cada um ganha uma alça para arrastar, um canto para redimensionar e um "x" para ocultar; a ajuda também liga e desliga cada um e tem "Resetar posições". A posição é salva em `overlay.config.json`.

### Adaptação ao tamanho do jogo

O overlay se ajusta sozinho à janela do TFT (janela redimensionada, ultrawide, 4:3, retrato, monitor ou escala de DPI diferentes). Tudo isso é **apresentação automática**: o layout que você salvou nunca é sobrescrito, o overlay só calcula um layout _efetivo_ a cada desenho.

- **Referência**: o HUD do TFT é 16:9 e escala sem esticar, então os elementos se medem pelo retângulo 16:9 do HUD (`hudRect` em `hud/geometry.mjs`), não pela janela inteira. Numa janela mais larga o HUD fica no centro e sobram faixas laterais; numa mais alta ele fica colado embaixo e sobra uma faixa em cima. Em janela 16:9 nada muda em relação ao layout antigo (as frações são as mesmas); layouts salvos continuam valendo sem migração.
- **Escala**: `--k` = (altura do HUD 16:9 / 1080) x a escala que você escolheu. A altura do HUD já é o menor dos eixos (altura/1080 ou largura/1920), então uma janela estreita não deixa o texto estourar. Piso de legibilidade 0,6 e teto 3: em janela muito pequena (por exemplo 960x540) a escala para no 0,6 e a ajuda avisa. Sua escala continua multiplicando por cima.
- **Colisões e prioridade**: do mais para o menos importante: `dock` (nunca é recolhido), `bar`, `roll`, `items`, `hints`, `plan`, `builds`. Cada elemento fica onde você o pôs; se colidir com outro mais importante, ele procura a vaga mais próxima na mesma coluna e, se faltar, nas faixas livres (barras laterais do ultrawide, faixa de cima das janelas altas), sempre sem cobrir o banco, a loja, nível/ouro nem o estágio do jogo. Sem vaga, é **recolhido**: some da tela, o dock mostra "N recolhidos" (com os nomes no tooltip) e a ajuda lista quais. Quando o espaço volta (janela maior, conteúdo menor), ele reaparece sozinho, com uma pequena folga para não piscar.
- **Modo interativo**: mostra o layout que você salvou, sem a adaptação, para você editar o que vê. Ao sair, a adaptação volta.
- **Tamanho detectado**: o dock mostra na dica dos pontos de saúde (e num chip só quando a escala bateu no piso ou no teto) `largura×altura (px físicos) · escala efetiva`, em âmbar quando o piso ou o teto de legibilidade agiu; o tooltip e a ajuda (`F8`, seção "Tamanho do jogo") dão proporção, tamanho do HUD, escala e o que foi recolhido ou reposicionado.
- **Redimensionar ao vivo**: enquanto o retângulo do jogo muda o rastreador passa a ler a cada 120 ms e volta aos 750 ms ~2,5 s depois de estabilizar. Mudança de até 2 px é ignorada (nada de piscar), as maiores são acompanhadas ao vivo e ~400 ms depois da última se faz o ajuste exato (inclusive o segundo `setBounds` do DPI misto). Trocar de monitor ou de escala (`display-metrics-changed`) é agrupado em uma única reação.
- **Minimizado/restaurado e janela ↔ janela sem borda**: o sumiço do jogo só conta depois de 1,5 s (a troca de modo de tela recria a janela por instantes). Passado o prazo o overlay é escondido (sem mexer na sua preferência de visível) e reaparece quando o jogo volta. O atalho de mostrar/esconder continua mandando.

### Ajuda (`?` ou `F8`)

Atalhos, categorias de dica, verbosidade, opacidade, escala, visibilidade dos elementos, calibrar, modo (integrado/painel), seguir o jogo e o estado das fontes: servidor, GEP (ativo/off), dados do jogador (pelo GEP ou "sem fonte", com a lista do que falta) e jogo (janela encontrada). O botão `?` do dock só recebe clique no modo interativo.

### Calibração (`F7`)

Os números de `HUD_REGIONS` valem para o HUD padrão medido numa captura 2044x1149; o **cartão inteiro da loja**, a **coluna do banco** e a **área nível/XP** são derivados (marcados `[ESTIMADO]` em `geometry.mjs`: `SHOP_CARD`, `BANK_PAD`, `LEVEL_XP_PAD`). O modo calibrar desenha o contorno de todas as âncoras e deixa ajustar por controles, sem captura de tela: deslocamento X/Y (setas, ±1 e ±5 px), escala (em torno do centro do HUD, 0,6 a 1,6) ou arrastando a grade; "Restaurar" e "Concluir". Fica salvo em `calibration`.

### Cliques: fora e dentro do modo de edição

- **Fora do modo de edição** (o normal): click-through total, todo clique vai para o jogo, exceto sobre os botões "⧉ Copiar" e "⌨" (ver acima).
- **Modo de edição** (`Ctrl+Shift+F10`, e também com a ajuda ou a calibração abertas): a janela captura o mouse **inteira**. É o modo de arrastar e redimensionar os blocos; nele o jogo não recebe cliques, o fundo fica levemente escurecido e um aviso no topo diz "Modo de edição · arraste os blocos · cliques não vão para o jogo · Ctrl+Shift+F10 ou Esc para voltar ao jogo". `Esc` é um atalho global registrado **só** enquanto o modo está ligado (a janela não é focável, então o foco fica sempre no jogo e não precisa voltar).

Por que assim: antes a página só pedia a captura ao receber o movimento do mouse encaminhado (`setIgnoreMouseEvents(true, { forward: true })`), e com o TFT em primeiro plano esse movimento não chegava; o clique "em cima do bloco" ia para o jogo. Cada mudança de captura e cada alternância do modo vão ao `overlay.log` (`captura: janela inteira (modo de edição)`, `captura: liberada`, `modo: interativo=...`), e o click-through é armado de novo a cada carga da página.

## Tela cheia exclusiva

O overlay só aparece sobre o TFT em **Janela** ou **Janela sem borda**. Em tela cheia exclusiva o Windows esconde janelas de outros programas. O overlay lê, somente leitura, o `FullscreenMode` do `GameUserSettings.ini` local do jogo (`%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\`; Unreal: 0 = tela cheia, 1 = janela sem borda, 2 = janela) quando o jogo aparece e mostra um aviso no dock se for 0. O arquivo pode estar defasado se o modo foi trocado dentro do jogo e ainda não foi aplicado. Nesta máquina o ini mostrava `FullscreenMode=2`, 1920x1080.

## Configuração local

`overlay/overlay.config.json` (criado e atualizado sozinho; valor inválido volta ao padrão):

| Campo             | Padrão                                   | Significado                                                                                                         |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `mode`            | `"integrated"`                           | `"integrated"` (cobre o jogo) ou `"panel"` (janelinha)                                                              |
| `follow`          | `true`                                   | acompanha a janela do TFT (integrado); desligado, cobre o monitor de `display`                                      |
| `layout`          | ver `hud/layout.mjs`                     | `{ id: { x, y, w, hidden } }` por elemento, em fração do retângulo 16:9 do HUD; `keys` tem também `folded` e `seen` |
| `calibration`     | `{dx:0,dy:0,scale:1}`                    | deslocamento (fração do HUD) e escala da grade de âncoras                                                           |
| `hints`           | `{categories:{...},verbosity:"minimal"}` | categorias ligadas e verbosidade                                                                                    |
| `devReload`       | `false`                                  | reinício automático do Electron quando muda o código do processo principal (desenvolvimento)                        |
| `defaultsVersion` | `2`                                      | versão dos padrões com que o arquivo foi gravado (origem dos valores; ver "Migração")                               |
| `port`            | `null`                                   | Porta do servidor; vazio usa `TFT_HELPER_PORT` e, sem ela, 3218 (sempre `127.0.0.1`)                                |
| `display`         | `"primary"`                              | Monitor da primeira colocação: `"primary"`, `"cursor"`, `"game"` ou id numérico                                     |
| `bounds`          | canto superior direito                   | `{x,y,width,height}` em DIP, do modo **painel** (o integrado nunca o sobrescreve)                                   |
| `scale`           | `1`                                      | Zoom do HUD, 0.6 a 2 (no integrado multiplica o tamanho dos elementos)                                              |
| `opacity`         | `0.92`                                   | Opacidade da janela, 0.2 a 1                                                                                        |
| `visible`         | `true`                                   | Começa visível                                                                                                      |
| `hotkeys`         | ver acima                                | `toggle`, `interactive`, `anchor`, `quit`, `help`, `calibrate`, `copyComp`                                          |

### Migração dos padrões

Como o arquivo é gravado inteiro, os padrões antigos ficam salvos mesmo sem o usuário ter mexido. Por isso o arquivo guarda `defaultsVersion` e, ao abrir, `loadAndMigrateConfig` (`config.mjs`) compara com a tabela `DEFAULT_CHANGES`: o que está **exatamente igual ao padrão antigo** passa ao novo; o que foi mudado à mão nunca é tocado. Antes de regravar faz o backup `overlay.config.json.bak-AAAAMMDD-HHMMSS` ao lado (fora do Git) e registra a migração no `overlay.log`. É idempotente: na versão atual nada muda, e uma escolha feita depois da migração (por exemplo voltar para a verbosidade "normal") é respeitada. v1 → v2: `hints.verbosity` "normal" → "minimal". Para mudar um padrão de posição no futuro, suba `DEFAULTS_VERSION` e acrescente o valor antigo do elemento em `DEFAULT_CHANGES.layout`.

## Ver as mudanças sem reiniciar o servidor (recarregamento automático)

O servidor serve `overlay/hud/**`, `v2/**` e `core/**` **lendo do disco a cada pedido** (`static-files.mjs`, `Cache-Control: no-cache`, sem cache em memória), então mudanças nesses arquivos não exigem reiniciar o servidor. O processo principal do overlay observa essas pastas (`dev-reload.mjs`) e:

| O que mudou                                                                                                                                                                                 | O que acontece                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlay/hud/**`, `v2/**`, `core/**` (o que a página carrega)                                                                                                                               | recarrega **só a página** do HUD (`reloadIgnoringCache`), preservando layout, modo e estado de interação (ficam no processo principal). Espera 3 s de silêncio e faz no máximo uma recarga a cada 10 s                                                                                       |
| `main.mjs`, `preload.cjs`, `config.mjs` e os módulos que o main importa (inclusive `hud/layout.mjs`, `hud/hints.mjs`, `hud/geometry.mjs`, `hud/hotkeys.mjs`, `probe.mjs`, `dev-reload.mjs`) | **desligado por padrão**: o log diz que vale no próximo início (a parte da página recarrega). Com `devReload: true` ou `TFT_OVERLAY_RELAUNCH=1`, reinicia só o Electron (`app.relaunch`) depois de conferir que o código novo carrega (`dev-check.mjs`); código que não carrega não reinicia |
| `overlay.config.json` editado por fora                                                                                                                                                      | igual à linha acima (a gravação do próprio overlay é ignorada)                                                                                                                                                                                                                               |
| `server.mjs`, `app/*` (por exemplo `app/overlay-feed.mjs`), `static-files.mjs`                                                                                                              | **nada**: é código do servidor e só vale depois de reiniciar o servidor                                                                                                                                                                                                                      |

Recarga e reinício **nunca** acontecem com a partida em andamento (janela do jogo presente), no modo de edição, com a ajuda ou a calibração abertas, nem durante um arraste: ficam guardados (`recarga adiada: <motivo> (N arquivos)` no log) e saem uma vez só quando o jogo some ou o modo fecha. `TFT_OVERLAY_WATCH=0` desliga tudo isso. A partida é detectada pela janela do jogo (rastreador do modo integrado); no modo painel ou sem seguir o jogo ela não é vista.

## De onde vêm os dados

O HUD consulta `GET /api/overlay?since=<rev>` a cada ~1 s. A rota é somente leitura e devolve o último `GET /api/state` e o último `POST /api/recommend` ao vivo que a interface web já recebeu, em memória, sem calcular nada. O overlay não pede análise por conta própria, porque isso dobraria o trabalho e alteraria o plano persistente.

```
GET /api/overlay[?since=<rev>]
{ "version": 1, "now": <ms>, "rev": "<estado>.<recomendação>",
  "unchanged": true,                      // só quando since == rev (sem state nem recommendation)
  "state":          null | { "at": <ms>, "ageMs": n, "body": <corpo de GET /api/state> },
  "recommendation": null | { "at": <ms>, "ageMs": n, "body": <corpo de POST /api/recommend> } }
```

Sem recomendação em cache, o HUD mostra o que o estado tem e "aguardando análise" (sem dicas). Partidas revistas (`replayGameId`) não entram no cache.

## Limitações e riscos

- **Nada da fase 2 foi verificado com o jogo aberto nem com o Electron em execução.** Alinhamento dos contornos, legibilidade das etiquetas, o pulso, o rastreador e a conversão de DPI só foram revisados no código. Os testes foram escritos, mas não foram executados quando o código foi entregue.
- **Valores estimados**: tamanho do cartão da loja, folga do banco e da área nível/XP. Use a calibração; coordenadas da loja e do HUD vêm de uma medição em 2044x1149 e podem não valer em outra resolução, outro tamanho de HUD nas opções do jogo ou outra versão do cliente.
- **O HUD não escala linearmente com a altura da janela** (medido em 2026-10 em vídeos do TFTAcademy e numa captura nativa, quando ainda havia leitura de tela; o registro está em `../.old/ocr/README.md` e no histórico do git): o passo entre os espaços do banco é 36 px em 720p (0,0500 da altura) e 56 px em 1149p (0,0487), e o rótulo do estágio fica em 0,401 da largura em 720p (cabeçalho expandido) e em 0,384 na captura nativa de 2044x1149 (cabeçalho recolhido): o efeito da resolução e o do estado recolhido/expandido não foram separados. `bankSlot.pitch` (0,04875) é a medida de 1149p e desvia ~0,9 px por espaço em 720p (8 px no 10º); o modo calibrar corrige o deslocamento e a escala da grade inteira. A altura do estágio vale só para o cabeçalho expandido do estágio 2 em diante.
- **Banco de itens**: a leitura não informa a posição de cada item, então a dica de item aponta para a coluna inteira do banco, não para um slot (o ponto de extensão `{kind:"bank", slot}` existe).
- **A análise vem do servidor**: com o laço automático do M10b (`app/auto-refresh.mjs`) o cache de recomendação é mantido durante a partida mesmo sem a interface web aberta. Em um servidor sem ele, a análise só existe enquanto a interface web está aberta e visível em algum lugar (o navegador pausa abas ocultas) e, sem ela, o overlay mostra o estado e "aguardando análise". Não foi verificado ao vivo se o laço mantém o cache.
- **O TFT precisa estar em janela ou janela sem borda** (ver acima).
- **Custo gráfico**: uma janela transparente do tamanho do jogo, sempre no topo, força a composição do Windows (DWM) sobre ele e pode custar fps ou latência. Só dá para medir com o jogo aberto.
- **DPI misto** (monitores com escala diferente): a conversão e o `setBounds` repetido não foram exercitados.
- **Adaptação ao tamanho** (`hud/fit.mjs`, `follow.mjs`): a lógica é pura e coberta por `tests/overlay-fit.test.mjs` (16:9, ultrawide 21:9 e 32:9, 4:3, retrato, 1280x720, 960x540, escala de DPI), mas **não foi vista ao vivo**: a cadência do rastreador (120 ms/750 ms), a ausência de piscada ao arrastar a borda do jogo, a conversão em DIP, o esconder/reexibir ao minimizar e a legibilidade real em janelas pequenas dependem do jogo e do Electron abertos. A altura de cada elemento vem da medida no DOM, então os números de espaço só se confirmam em execução. O piso de escala (0,6) e as larguras mínimas lógicas (300 px; 270 px no dock) são escolhas de legibilidade a ajustar com o uso.
- **Vanguard não foi testado.** Não há texto da Riot sobre janelas sempre-no-topo; se o Vanguard avisar ou bloquear algo, pare e registre a mensagem.
- A política da Riot restringe o conteúdo (sugestões sobre o estado atual, scouting de rivais), não o lugar onde ele é desenhado. O overlay mostra apenas o que a interface web já mostra.
- Janela transparente do Electron no Windows depende da GPU; se aparecer fundo preto, avise antes de mexer em `disableHardwareAcceleration`.
- Apenas Windows foi considerado.

## Arquivos

| Arquivo                                                                                                     | Papel                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `main.mjs`                                                                                                  | processo principal: janela, palco sobre o jogo, atalhos, sonda do servidor, IPC                        |
| `preload.cjs`                                                                                               | ponte `window.overlayHost` (contrato versão 2; só pede ajustes da própria janela, nunca envia entrada) |
| `config.mjs`                                                                                                | configuração pura e testável (modo, layout, calibração, dicas, estados de interação)                   |
| `game-tracker.mjs`                                                                                          | PowerShell persistente somente-leitura com a área cliente da janela do TFT (cadência adaptativa)       |
| `follow.mjs`                                                                                                | filtro puro do acompanhamento: tolerância de 2 px, ajuste exato ao assentar, prazo de perda do jogo    |
| `hud/fit.mjs`                                                                                               | adaptação ao tamanho do jogo (puro): quadro do HUD, escala, colisões, prioridade e recolhimento        |
| `game-window.mjs`                                                                                           | consulta opcional e única da janela do jogo (`display: "game"`)                                        |
| `display-mode.mjs`                                                                                          | lê o `FullscreenMode` do ini local e produz o aviso de tela cheia exclusiva                            |
| `offline.html`                                                                                              | aviso quando o servidor não responde                                                                   |
| `hud/`                                                                                                      | página do HUD, servida pelo servidor em `/overlay/`                                                    |
| `hud/view.mjs`, `hud/hints.mjs`                                                                             | modelo de tela e motor de dicas (puros)                                                                |
| `hud/geometry.mjs`, `hud/layout.mjs`                                                                        | geometria das âncoras e layout dos elementos (puros)                                                   |
| `hud/markers.mjs`, `hud/widgets.mjs`, `hud/help.mjs`, `hud/calibrate.mjs`, `hud/health.mjs`, `hud/draw.mjs` | desenho das marcas, elementos, ajuda, calibração, saúde e cartões                                      |
| `hud/hotkeys.mjs`                                                                                           | lista única dos atalhos (main registra, legenda e ajuda mostram)                                       |
| `hud/keys.mjs`                                                                                              | legenda compacta, botão "Copiar comp" e aviso do modo de edição (puros)                                |
| `probe.mjs`                                                                                                 | regra da sonda do servidor (porta fechada x lentidão; não troca o HUD carregado)                       |
| `dev-reload.mjs`, `dev-check.mjs`                                                                           | recarregamento automático (observar, agrupar, adiar) e a verificação antes de reiniciar o Electron     |

O servidor mapeia `/overlay/*` para `overlay/hud/` (`static-files.mjs`) e guarda o feed em `app/overlay-feed.mjs`. Testes: `tests/overlay-keys.test.mjs` (atalhos, copiar comp, regiões quentes, recarga, sonda, migração), `tests/overlay-config.test.mjs`, `tests/overlay-fit.test.mjs`, `tests/overlay-game.test.mjs`, `tests/overlay-geometry.test.mjs`, `tests/overlay-hints.test.mjs`, `tests/overlay-page.test.mjs`, `tests/overlay-hud.test.mjs`, `tests/overlay-feed.test.mjs`, `tests/static-files.test.mjs`.

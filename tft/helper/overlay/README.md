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

Se o servidor não responde, a janela mostra um aviso discreto e volta ao HUD sozinha quando ele voltar (sonda a cada 3 s). O overlay nunca encerra por causa do servidor.

## Atalhos globais

Padrão (configuráveis em `overlay.config.json`; usam teclas de função porque Ctrl+Alt equivale ao AltGr em teclados como o ABNT2):

| Atalho              | Ação                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| `Control+Shift+F9`  | mostrar/esconder                                                                      |
| `Control+Shift+F10` | modo interativo (arrastar e redimensionar os elementos; sair devolve o click-through) |
| `Control+Shift+F8`  | abrir/fechar a ajuda (liga o modo interativo junto)                                   |
| `Control+Shift+F7`  | abrir/fechar a calibração (liga o modo interativo junto)                              |
| `Control+Shift+F11` | integrado: procura a janela do jogo de novo; painel: ancora ao monitor do TFT         |
| `Control+Shift+F12` | sair                                                                                  |

Se algum atalho já estiver em uso por outro programa, o registro falha em silêncio no Electron; o overlay avisa no console e em `overlay.log`.

## Modo integrado

### Como se ancora ao jogo

Um PowerShell **persistente e somente-leitura** (`game-tracker.mjs`) lê a cada ~750 ms a posição da área cliente da janela do TFT (classe `UnrealWindow`, título começando por "TFT", visível e não minimizada: a mesma identificação do leitor de tela) com `EnumWindows`, `GetClientRect` e `ClientToScreen`. Nada além de posição. O Electron coloca a janela transparente exatamente sobre essa área (convertida para DIP) e acompanha se o jogo mudar de lugar ou de tamanho. Sem o jogo, a janela cobre o monitor, as âncoras somem e os cartões continuam (o indicador de saúde do dock avisa "Janela do TFT não encontrada").

O HUD do TFT é 16:9 e escala sem esticar. O retângulo 16:9 é calculado como em `Hud-Rect` do `screen-reader.ps1`, e as frações das regiões (loja, banco de itens, ouro, nível, XP, estágio) são as **mesmas** do leitor de tela, em um módulo único (`hud/geometry.mjs`). `tests/overlay-geometry.test.mjs` lê o `.ps1` e falha se algum número divergir.

### O que aparece sobre o jogo

Cada dica tem categoria, prioridade, âncora, texto curto, ícone e ação sugerida (`hud/hints.mjs`). Todas derivam de campos que o servidor já entrega:

| Categoria                        | Exemplos                                                                                                           | Âncora         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------- |
| compra (`buy`)                   | "Compre Veigar" com contorno pulsante no slot da loja (tracejado e "?" se a loja foi lida da tela e é só provável) | slot da loja   |
| itens (`items`)                  | "Passe X de A para B", "Equipe X em Y", "Monte X com A+B"                                                          | banco de itens |
| ouro/rolagem (`gold`)            | "Role até Ng, pare em Mg", "Vale esperar o nível N", "Suba de nível (Ng)", marca de juros, selo do nível           | ouro, nível    |
| Wisps (`wisp`)                   | "Wisp X: comprar/avaliar/pular" com o motivo do servidor                                                           | slot da loja   |
| aprendizado (`learn`, desligada) | o porquê, só com textos do servidor (economia, nível, rolagem)                                                     | ouro, nível    |
| alerta                           | perigo de vida (valor `pressure` do servidor); nunca é desligável                                                  | ouro           |

A verbosidade controla o teto e a prioridade mínima (`minimal`: 3 dicas importantes; `normal`: até 5; `detailed`: até 8, com o porquê junto). Dicas sem alvo geométrico aparecem só na lista "Dicas". Dados velhos (leitura ou análise antigas) esmaecem e perdem o pulso.

### Elementos posicionáveis

Sete elementos (`dock`, `bar`, `hints`, `roll`, `items`, `builds`, `plan`), com posição e largura em fração da tela, mantidos dentro das bordas (margem de 0,75%, como o TFTAcademy). `builds` e `plan` começam ocultos. No modo interativo (`F10`) cada um ganha uma alça para arrastar, um canto para redimensionar e um "x" para ocultar; a ajuda também liga e desliga cada um e tem "Resetar posições". A posição é salva em `overlay.config.json`.

### Ajuda (`?` ou `F8`)

Atalhos, categorias de dica, verbosidade, opacidade, escala, visibilidade dos elementos, calibrar, modo (integrado/painel), seguir o jogo e o estado das fontes: servidor, GEP (ativo/off), tela (leitor) e jogo (janela encontrada). O botão `?` do dock só recebe clique no modo interativo.

### Calibração (`F7`)

Os números do leitor de tela valem para o HUD padrão medido numa captura 2044x1149; o **cartão inteiro da loja**, a **coluna do banco** e a **área nível/XP** são derivados (marcados `[ESTIMADO]` em `geometry.mjs`: `SHOP_CARD`, `BANK_PAD`, `LEVEL_XP_PAD`). O modo calibrar desenha o contorno de todas as âncoras e deixa ajustar por controles, sem captura de tela: deslocamento X/Y (setas, ±1 e ±5 px), escala (em torno do centro do HUD, 0,6 a 1,6) ou arrastando a grade; "Restaurar" e "Concluir". Fica salvo em `calibration`.

### Cliques no resto da tela

Mesmo no modo interativo a janela continua com click-through e a página só captura o mouse enquanto o ponteiro está sobre um elemento do overlay (`setIgnoreMouseEvents(true, { forward: true })` com alternância pelo ponteiro). O resto do jogo continua clicável. A janela nunca toma o foco (`focusable: false`).

## Tela cheia exclusiva

O overlay só aparece sobre o TFT em **Janela** ou **Janela sem borda**. Em tela cheia exclusiva o Windows esconde janelas de outros programas. O overlay lê, somente leitura, o `FullscreenMode` do `GameUserSettings.ini` local do jogo (`%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\`; Unreal: 0 = tela cheia, 1 = janela sem borda, 2 = janela) quando o jogo aparece e mostra um aviso no dock se for 0. O arquivo pode estar defasado se o modo foi trocado dentro do jogo e ainda não foi aplicado. Nesta máquina o ini mostrava `FullscreenMode=2`, 1920x1080.

## Configuração local

`overlay/overlay.config.json` (criado e atualizado sozinho; valor inválido volta ao padrão):

| Campo         | Padrão                                  | Significado                                                                          |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `mode`        | `"integrated"`                          | `"integrated"` (cobre o jogo) ou `"panel"` (janelinha)                               |
| `follow`      | `true`                                  | acompanha a janela do TFT (integrado); desligado, cobre o monitor de `display`       |
| `layout`      | ver `hud/layout.mjs`                    | `{ id: { x, y, w, hidden } }` por elemento, em fração da tela                        |
| `calibration` | `{dx:0,dy:0,scale:1}`                   | deslocamento (fração do HUD) e escala da grade de âncoras                            |
| `hints`       | `{categories:{...},verbosity:"normal"}` | categorias ligadas e verbosidade                                                     |
| `port`        | `null`                                  | Porta do servidor; vazio usa `TFT_HELPER_PORT` e, sem ela, 3218 (sempre `127.0.0.1`) |
| `display`     | `"primary"`                             | Monitor da primeira colocação: `"primary"`, `"cursor"`, `"game"` ou id numérico      |
| `bounds`      | canto superior direito                  | `{x,y,width,height}` em DIP, do modo **painel** (o integrado nunca o sobrescreve)    |
| `scale`       | `1`                                     | Zoom do HUD, 0.6 a 2 (no integrado multiplica o tamanho dos elementos)               |
| `opacity`     | `0.92`                                  | Opacidade da janela, 0.2 a 1                                                         |
| `visible`     | `true`                                  | Começa visível                                                                       |
| `hotkeys`     | ver acima                               | `toggle`, `interactive`, `anchor`, `quit`, `help`, `calibrate`                       |

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
- **Banco de itens**: a leitura não informa a posição de cada item, então a dica de item aponta para a coluna inteira do banco, não para um slot (o ponto de extensão `{kind:"bank", slot}` existe).
- **A análise vem do servidor**: com o laço automático do M10b (`app/auto-refresh.mjs`) o cache de recomendação é mantido durante a partida mesmo sem a interface web aberta. Em um servidor sem ele, a análise só existe enquanto a interface web está aberta e visível em algum lugar (o navegador pausa abas ocultas) e, sem ela, o overlay mostra o estado e "aguardando análise". Não foi verificado ao vivo se o laço mantém o cache.
- **O TFT precisa estar em janela ou janela sem borda** (ver acima).
- **Custo gráfico**: uma janela transparente do tamanho do jogo, sempre no topo, força a composição do Windows (DWM) sobre ele e pode custar fps ou latência. Só dá para medir com o jogo aberto.
- **DPI misto** (monitores com escala diferente): a conversão e o `setBounds` repetido não foram exercitados.
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
| `game-tracker.mjs`                                                                                          | PowerShell persistente somente-leitura com a área cliente da janela do TFT                             |
| `game-window.mjs`                                                                                           | consulta opcional e única da janela do jogo (`display: "game"`)                                        |
| `display-mode.mjs`                                                                                          | lê o `FullscreenMode` do ini local e produz o aviso de tela cheia exclusiva                            |
| `offline.html`                                                                                              | aviso quando o servidor não responde                                                                   |
| `hud/`                                                                                                      | página do HUD, servida pelo servidor em `/overlay/`                                                    |
| `hud/view.mjs`, `hud/hints.mjs`                                                                             | modelo de tela e motor de dicas (puros)                                                                |
| `hud/geometry.mjs`, `hud/layout.mjs`                                                                        | geometria das âncoras e layout dos elementos (puros)                                                   |
| `hud/markers.mjs`, `hud/widgets.mjs`, `hud/help.mjs`, `hud/calibrate.mjs`, `hud/health.mjs`, `hud/draw.mjs` | desenho das marcas, elementos, ajuda, calibração, saúde e cartões                                      |

O servidor mapeia `/overlay/*` para `overlay/hud/` (`static-files.mjs`) e guarda o feed em `app/overlay-feed.mjs`. Testes: `tests/overlay-config.test.mjs`, `tests/overlay-game.test.mjs`, `tests/overlay-geometry.test.mjs`, `tests/overlay-hints.test.mjs`, `tests/overlay-page.test.mjs`, `tests/overlay-hud.test.mjs`, `tests/overlay-feed.test.mjs`, `tests/static-files.test.mjs`.

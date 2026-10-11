# Overlay e eventos: opções reais para o helper (ow-electron, Overwolf, janelas sem injeção)

Pesquisa de 2026-10-10 (Set 18, patch 18.4). Notas em português; citações curtas em inglês, como nas fontes. Nada de código foi alterado.
Não repete `07-ferramentas-e-regras-da-riot.md` (política de conteúdo) nem `canais-locais-alternativos.md` (canais de dados já medidos); só os cita.

Legenda: **[DOC]** documentação oficial lida inteira nesta sessão; **[MEDIDO]** verificado por mim nesta máquina; **[VENDOR]** afirmação de empresa sobre o próprio produto; **[SECUNDÁRIO]** terceiros; **[INFERÊNCIA]** leitura minha; **[NÃO TESTADO]** desenho plausível que ninguém rodou com o TFT; **[NÃO ENCONTREI]**.

---

## 1. Resumo executivo

1. **O ow-electron resolve o problema técnico (GEP + overlay dentro de um processo Node/Electron), mas a porta de entrada provavelmente está fechada para um app pessoal.** Sem credenciais, "the gaming packages stay inactive". Credenciais do Dev Mode (`OW_DEV_KEY`) exigem "Developer status ... Approved", e "DevRel reviews app idea submissions manually"; as credenciais de Console só existem "after your app passes QA review". A página de roadmap do Overwolf diz: **"Overwolf currently doesn't approve private apps."**, e "won't approve any app that doesn't integrate Overwolf ads or Overwolf subscriptions". [DOC]
2. Existe um conflito de políticas em cadeia: o Overwolf só aprova apps com anúncios/assinatura, e a Riot proíbe anúncios de terceiros em overlays desde 2025-05-29. Para publicar, a Riot também exige aprovação. Um helper pessoal não se encaixa em nenhum dos dois caminhos. [DOC] + [FATO-RIOT via blog Overwolf]
3. **O pacote `overlay` do Overwolf não é uma janela transparente comum: ele injeta no processo do jogo** (renderiza a janela "dentro" do quadro do jogo; no ow-electron, com textura compartilhada D3D11/D3D12). Localmente o log do Overwolf mostra `owe-client-x64.dll` injetada no PID do TFT. Isso é exatamente o que a nota 07 manda evitar replicar por conta própria. [DOC] + [MEDIDO em canais-locais]
4. **A fonte de eventos que já funciona é a atual: ler o banco do TFTAcademy (`gep-reader.mjs`).** É a única opção de eventos GEP que não exige conta, aprovação nem pacote novo. Fragilidade: esquema privado e depende de Overwolf+TFTAcademy rodando.
5. **Para exibir, existem 5 opções sem injeção e sem dependência nova**, nenhuma testada com o TFT: (a) janela do navegador em outro monitor/ao lado (status quo); (b) **Edge Game Assist fixado ("Pin")** com transparência ajustável, abrindo `http://127.0.0.1:3218` [DOC Microsoft; URL localhost "Not covered"]; (c) **Document Picture-in-Picture** do Chrome/Edge (janela HTML sempre no topo, exige gesto do usuário); (d) PowerToys Always On Top sobre uma janela `--app`; (e) segundo dispositivo (celular/tablet) via LAN.
6. **Uma janela transparente click-through própria exige o pacote `electron`** (decisão do usuário). `setIgnoreMouseEvents(true, {forward:true})` + `setAlwaysOnTop(true,'screen-saver')` + `transparent` cobrem o caso; só aparece sobre jogo em janela ou janela sem borda (não sobre fullscreen exclusivo). [DOC Electron]
7. **Medido nesta máquina:** `%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\GameUserSettings.ini` tem `FullscreenMode=2` (Windowed no enum do Unreal: 0=Fullscreen, 1=WindowedFullscreen, 2=Windowed), `PreferredFullscreenMode=1`, 1920x1080. Ou seja, o cliente Unreal do TFT já está em modo janela aqui; qualquer overlay sem injeção só precisa de janela/janela sem borda. [MEDIDO] + [DOC Epic]
8. **Política Riot independe do canal de exibição.** O que o texto da Riot restringe é o conteúdo (sugestão por estado atual, scouting), não onde ele é desenhado (nota 07). Não achei declaração da Riot sobre janelas sempre-no-topo, segundo monitor, nem sobre captura de tela. [NÃO ENCONTREI]

---

## 2. Ponto de partida do projeto (o que já existe)

- Servidor Node 24.18 (`server.mjs`, porta 3218 por `TFT_HELPER_PORT`), interface v2 em `tft/helper/v2/`, sem build, sem pacotes. [MEDIDO: `node -v`, `grep 3218`]
- `gep-reader.mjs` já lê o SQLite do TFTAcademy em modo somente leitura via `node:sqlite` (ouro, nível/XP, loja, reserva, banco de itens do jogador local; descarta rivais e aprimoramentos). Decisão do usuário de 2026-10-10 registrada em `FONTES-DE-DADOS.md`. Frescor: `GEP_STALE_MS = 60 s`. [MEDIDO: leitura dos arquivos]
- Não existe hoje nenhuma dependência de overlay; a exibição é a interface web em navegador.

---

## 3. Parte A: receber eventos do jogo (GEP)

### 3.1 Fatos da plataforma ow-electron [DOC]

| Tema                      | Fato                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fonte                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O que é                   | Fork do Electron com APIs Overwolf; "most of its changes are closed source" (FAQ). Três pacotes npm: `@overwolf/ow-electron`, `@overwolf/ow-electron-builder`, `@overwolf/electron-is-overwolf`. Tipos em `@overwolf/ow-electron-packages-types` (1.1.12)                                                                                                                                                                                  | [technical overview](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-technical-overview), [FAQ](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq), npm             |
| Versão                    | Latest no npm: **42.11.4**, licença MIT declarada no npm (publicado/modificado 2026-10-04). O Electron oficial está em **44.7.0**. O ow-electron está 2 majors atrás; a política do Electron mantém suporte aos "latest three stable major versions" (42, 43, 44)                                                                                                                                                                          | `npm view` hoje; [electron-timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)                                                                                                                                         |
| Plataformas               | Overlay, game events e gravação: só Windows. "Only ad services currently work on Mac and Linux"                                                                                                                                                                                                                                                                                                                                            | FAQ                                                                                                                                                                                                                                               |
| Pacotes                   | `overwolf.packages` no `package.json`: `gep`, `overlay`, `recorder` (beta). Os pacotes são baixados/atualizados "every few hours", instalados na inicialização; reinício aplica                                                                                                                                                                                                                                                            | [first-app](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/first-app), FAQ                                                                                                                                             |
| Node                      | Pré-requisito do guia: Node 18+; o sample usa webpack/TypeScript, mas nada impede JS puro [INFERÊNCIA]                                                                                                                                                                                                                                                                                                                                     | first-app                                                                                                                                                                                                                                         |
| Cliente Overwolf          | A doc não diz se é obrigatório. Localmente o MetaTFT Standalone (ow-electron) baixa o pacote `gep` de `electrondl.overwolf.com` e injeta no jogo                                                                                                                                                                                                                                                                                           | FAQ; canais-locais [MEDIDO]                                                                                                                                                                                                                       |
| Admin                     | Se o jogo roda elevado, o app precisa de admin; app admin não injeta em jogo não admin. Overlay 2.0.9 (agosto 2026) corrigiu "overlay not visible when the app or game runs as administrator"                                                                                                                                                                                                                                              | FAQ; changelog                                                                                                                                                                                                                                    |
| Assinatura (distribuição) | Exige certificado de código próprio **e** assinatura da Overwolf; sem as duas "GEP, Overlay, and Recorder won't load". Exige app registrado no Console com App UID e `OW_BUILD_KEY`                                                                                                                                                                                                                                                        | [app-signing](https://dev.overwolf.com/ow-electron/guides/dev-tools/app-signing/)                                                                                                                                                                 |
| Dev Mode                  | Desde ow-electron 39.8.10 + ow-electron-builder 26.9.0, só Windows. Pula a maioria das checagens de produção, **mas** "you must authenticate with Overwolf before gaming packages load"                                                                                                                                                                                                                                                    | [dev-mode](https://dev.overwolf.com/ow-electron/guides/dev-tools/dev-mode/)                                                                                                                                                                       |
| Credenciais do Dev Mode   | Opção A: `OW_DEV_KEY` gerada no perfil dev.overwolf.com "once your Developer status is Approved"; Pending = não gera. Opção B: `OW_CLI_EMAIL`+`OW_CLI_API_KEY` do Console, "available only after your app passes QA review". Variáveis de ambiente têm precedência                                                                                                                                                                         | dev-mode                                                                                                                                                                                                                                          |
| Aprovação de ideia        | Fase 1: DevRel classifica o app como Public ou Private. "Private ... Overwolf currently doesn't approve private apps." "Using Overwolf's APIs require your app idea to be whitelisted ... only given to app ideas submitted and approved using the App proposal process." Apps só com processo de fundo não são aprovados (precisam de uma janela). Monetização: ads e/ou assinaturas Overwolf; "Third-party monetization is not approved" | [project-roadmap](https://dev.overwolf.com/ow-native/getting-started/project-roadmap/)                                                                                                                                                            |
| Riot                      | "If you wish to integrate your app with any of Riot's games, you are required to seek their approval through their 3rd party application process"; para a ideia não precisa, mas apps que chegam à publicação sem aprovação terão de apresentá-la                                                                                                                                                                                          | [compliance TFT](https://dev.overwolf.com/ow-electron/guides/game-compliance/teamfight-tactics)                                                                                                                                                   |
| Anúncios                  | Riot, 2025-05-29: "Third party in-game advertisements are no longer allowed, this includes ads in overlays, during loading screens, and in the Riot Client." A Overwolf respondeu em 2025-06-05 que estava avaliando e buscaria "alternative monetization methods"                                                                                                                                                                         | [blog Overwolf](https://blog.overwolf.com/supporting-creators-in-riots-ecosystem-our-response-and-commitment/); [Riot Developer Policy](https://developer.riotgames.com/policies/general) ("You may not place advertisements in Riot properties") |
| Fórum antigo              | Um staff da Overwolf (~4 anos atrás, segundo o resumo da busca; página `discuss.overwolf.com` não resolveu para mim) teria dito que se pode criar app só para uso pessoal enviando proposta. Contradiz a doc atual; a doc é mais recente                                                                                                                                                                                                   | [SECUNDÁRIO, não aberto]                                                                                                                                                                                                                          |

**Leitura (INFERÊNCIA):** para um app puramente pessoal, o caminho ow-electron exige (1) aprovação manual da DevRel para uma ideia que a própria doc classifica como "private" e diz não aprovar, ou (2) fingir que o app é público com ads/assinatura, o que não é verdade e conflita com a regra da Riot sobre anúncios. Eu não recomendo (2). A única forma limpa de saber é perguntar à Overwolf (developers@overwolf.com, citado na página de roadmap) com o caso exato. Não achei resposta pública recente sobre "uso pessoal".

### 3.2 O que o GEP entrega para TFT (resumo; detalhe em canais-locais)

[DOC] [TFT events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics/), lido inteiro hoje:

- Features: `gep_internal`, `game_info`, `live_client_data`, `me` (`gold`, `xp`, `health`, `rank`, `summoner_name`), `match_info`, `roster`, `store` (`shop_pieces`), `board`, `bench`, `carousel`, `augments`, `match_stats`.
- **Dados de rivais no próprio GEP:** `opponent` e `round_outcome` (todos os jogadores), `roster.player_status` (todos), `board.opponent_board_pieces`, `bench.item_bench` (todos os jogadores), `match_stats.board_players` (tabuleiro e reserva de todos por estágio), `board_spectate`, `battle_stats`.
- **Aprimoramentos proibidos pela própria Overwolf:** "do not include augment data"; o dado "cannot be displayed in third-party apps or websites"; violaria os Termos da Riot e "can result in banning".
- Quirks relevantes: `rank` do roster só é correto ao fim da partida; nomes aparecem na tela de carregamento, saúde/XP só quando o jogo começa; `match_state` fica `true` ao começar e `false` quando o jogador morre ou vence.
- IDs de jogo: a doc ainda diz "TFT, TFT PBE and LoL share one Game ID" (21570; PBE 28162); a medição local mostra o cliente dedicado como **28164** (canais-locais). Qualquer integração deve registrar os dois.
- Regras de uso: o GEP só entrega o que o app assinou por `setRequiredFeatures`; "Late registration can cause missing events"; `getInfo()` devolve o estado atual ao abrir no meio da partida; "Avoid logging GEP data to any of the log files" ([intro GEP](https://dev.overwolf.com/ow-native/live-game-data-gep/live-game-data-gep-intro)).
- A Overwolf não documenta como o GEP lê o jogo; o aviso da Riot de 2026-10-06 (bloqueio de memória por padrão, carência até abril/2027 para ferramentas "known and currently approved") **não cita Overwolf nem GEP**. Se o GEP lê memória, a continuidade depois de abril/2027 é incerta. [NÃO ENCONTREI declaração da Overwolf sobre isso]

### 3.3 Opções para receber eventos

#### A1. Banco do TFTAcademy (status quo, já implementado)

- **Entrega:** ouro, nível/XP, loja, reserva e banco de itens do jogador local, ~1 s de resolução; sem tela. [MEDIDO em 2026-09-11, uma partida de ~60 s]
- **Passos:** nenhum novo. Overwolf e TFTAcademy abertos durante a partida.
- **Esforço:** zero (feito). Falta teste com uma partida longa e latência em ms (já listado como lacuna em canais-locais).
- **Requisitos/credenciais:** conta nenhuma no helper; o TFTAcademy tem a própria conta/licença.
- **Risco Riot/anti-cheat:** nenhum acréscimo pelo helper (lê arquivo de outro app). O risco de conta é o do uso do Overwolf/TFTAcademy pelo próprio usuário, não mensurável aqui.
- **Manutenção:** média/alta; esquema Drizzle privado pode mudar sem aviso; depende de dois apps de terceiros e do GEP seguir funcionando (patches do Set 18 já exigiram correções: 314.0.2, 315.0.1).
- **Cabe no projeto:** sim; é o que o projeto já faz.

#### A2. ow-electron em Dev Mode (GEP dentro de um processo Electron que também hospeda o servidor)

- **Entrega:** os mesmos eventos de A1, em tempo real, sem depender do TFTAcademy; `getInfo()` na entrada tardia; você controla as features (ex.: não assinar `augments`).
- **Passos (se elegível):** (1) criar conta Overwolf e submeter a ideia; esperar aprovação da DevRel; (2) gerar `OW_DEV_KEY` (ou obter credenciais do Console após QA); (3) `npm i @overwolf/ow-electron @overwolf/ow-electron-packages-types` (substitui `electron`); (4) `package.json` com `"overwolf": {"packages": ["gep"]}`; (5) na main: `app.overwolf.packages.gep.on('game-detected', (e, gameId) => { e.enable(); })` e `setRequiredFeatures(gameId, [...])` com `me, store, bench, match_info, roster`, sem `augments`; (6) `on('new-info-update'/'new-game-event')` repassa ao servidor (mesmo processo); (7) executar com `ow-electron .` em terminal (o guia manda iniciar como administrador no Windows). Sample oficial: [ow-electron-packages-sample](https://github.com/overwolf/ow-electron-packages-sample) (`game-events.service.ts` usa `setRequiredFeatures(gameId, null)`).
- **Esforço:** 2–4 dias de código/teste, mais espera de aprovação desconhecida. Reescrita do "launcher" do servidor para rodar sob `ow-electron` (hoje é `node server.mjs`).
- **Requisitos:** Windows; conta Overwolf; ideia aprovada; credenciais em variáveis de ambiente; build dev (não distribuível sem assinatura).
- **Risco:** política Riot de conteúdo é a mesma da nota 07; risco extra de ter um processo Overwolf injetando no jogo (já ocorre com TFTAcademy/MetaTFT). O Dev Mode é para testes locais; usá-lo como produção pessoal permanente não é descrito pela doc.
- **Manutenção:** alta: dependência de pacote em 42.x (2 majors atrás do Electron), pacotes `gep`/`overlay` auto-atualizados, correções por patch do jogo.
- **Cabe no projeto:** **não sem decisão do usuário**: adiciona um pacote (`@overwolf/ow-electron`, com binário Electron baixado no `postinstall` [INFERÊNCIA pela dependência `@electron/get`]) e muda o modelo "Node ESM, sem build, dependências mínimas". Bloqueio de elegibilidade provável (seção 3.1).

#### A3. App Overwolf nativo com ponte HTTP para o servidor

- **Entrega:** mesmos eventos; app JS rodando no CEF do Overwolf, que envia por `overwolf.web.sendHttpRequest` para `http://127.0.0.1:3218` (desenho já anotado em canais-locais; nenhum exemplo oficial GEP→localhost).
- **Requisito crítico:** "To develop, load or run unpacked or unreleased apps, you have to get whitelisted first" ([setting-up-dev-environment](https://dev.overwolf.com/ow-native/getting-started/onboarding-resources/setting-up-dev-environment)). Mesma barreira de A2 (whitelist só pelo processo de proposta; "private" não é aprovado).
- **Precedente:** o repositório TFT-OpenOverlay (daKires), PR #7 mesclado em 2026-09-22, é um app Overwolf nativo (manifest, `background.js`, hotkey Ctrl+Shift+T, "Load unpacked", gameId 21570) que mapeia GEP para unidades e economia. O PR não menciona whitelist nem credenciais; o autor diz que a validação real "must be done manually in the Overwolf client". Não sei se o autor está whitelisted. [SECUNDÁRIO: `github.com/daKires/TFT-OpenOverlay/pull/7`]
- **Esforço:** 1–2 dias após liberação. **Risco/manutenção:** como A2. **Cabe no projeto:** não adiciona pacote npm ao helper (o app Overwolf é um artefato separado), mas exige o cliente Overwolf com modo de desenvolvedor liberado.

#### A4. Reaproveitar outro app já aprovado como ponte

- Mobalytics Desktop, MetaTFT Standalone e TFTAcademy já recebem GEP. Só o TFTAcademy tem arquivo legível (A1). O IndexedDB do MetaTFT e os dados do Mobalytics não foram inspecionados (canais-locais). Não encontrei API local, socket ou WebSocket documentado em nenhum deles. [NÃO ENCONTREI]

#### A5. O que não existe

- Socket público do Overwolf para processos externos: não encontrei. A Overwolf diz em seu "commitment" que não abre a tecnologia como motor genérico para impedir cheats (resumo de busca; texto em [overwolf.com/our-commitment](https://overwolf.com/our-commitment/)). Reimplementar o plugin (`gep_tft.dll`) é injeção e fica fora (nota 07, seção 10 de canais-locais).

---

## 4. Parte B: mostrar informação ao jogador

### 4.1 Fatos de exibição (válidos para todas as opções)

- **Modo de janela é o fator decisivo.** O Unreal tem três modos (Epic): `FULLSCREEN` (0, "true fullscreen"), `WINDOWED_FULLSCREEN` (1, "a borderless window that covers the entire screen area"), `WINDOWED` (2, "a bordered window that may not fill the whole screen") ([Epic Python API WindowMode](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/WindowMode)). A numeração em `GameUserSettings.ini` (0/1/2) vem de resposta de fórum, não de cabeçalho do motor [SECUNDÁRIO]. **Medido aqui:** `FullscreenMode=2`, `LastConfirmedFullscreenMode=2`, `PreferredFullscreenMode=1`, `ResolutionSize 1920x1080`. [MEDIDO, leitura do ini]
- **Fullscreen exclusivo esconde janelas de outros apps; janela sem borda mostra.** A Microsoft documenta que no modelo "flip" a janela do jogo pode ser apresentada por "DirectFlip/Independent Flip" e que, "If other desktop contents come on top, the DWM can either seamlessly transition back to composed mode, efficiently 'reverse compose' ... or leverage MPO", e diz que o modo janela sem borda é "equivalent or better" ao exclusivo ([Learn: DXGI flip model](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model)). Isso sustenta que uma janela `TOPMOST` aparece sobre um jogo em janela sem borda; **não testei com o TFT**. [NÃO TESTADO]
- **Requisito mínimo do cliente novo:** Windows 10 19041+, DirectX 11 Feature Level 4.3 ([FAQ Unreal da Riot](https://support.riotgames.com/en-us/tft/client/tft-unreal-engine-migration-faq)). O FAQ não cita modos de janela, Vanguard, terceiros nem Overwolf. [NÃO ENCONTREI modos oferecidos no menu do cliente novo]
- **Overwolf, modos de exibição:** a documentação só trata do problema de fullscreen não-borderless para CS, Warzone e Destiny 2 ("exclusive mode is completely disabled"); a página também se contradiz sobre captura em modo janela (já sinalizado por mim; verificar antes de depender). Nada específico para TFT. [DOC] [NÃO ENCONTREI para TFT]
- **Vanguard (Riot):** "Overlays and internal tools using the API, game client, and in-game APIs should continue to function." "There is absolutely no allow list for Vanguard." ([Vanguard FAQ](https://www.riotgames.com/en/DevRel/vanguard-faq)). Não há texto da Riot sobre janelas transparentes ou sobre o que o Vanguard faz com elas. Guias de terceiros (Backgrind, vendor, 2026-07-03) afirmam que o Vanguard "targets injected code and cheat drivers, not separate windows"; é interpretação de empresa que vende overlay. [VENDOR] [NÃO ENCONTREI texto da Riot]
- **Memória:** o bloqueio de acesso à memória (2026-10-06) não afeta janelas que não leem memória. [FATO-RIOT, nota 07]

### 4.2 Como o overlay do Overwolf desenha (para entender a diferença)

- [DOC] "Overlay is the ability to show windows on top of the current game window." Duas modalidades: **standard** (cursor visível, como MOBA; o usuário interage sem tirar o foco do jogo) e **exclusive** (cursor oculto; janela semitransparente que bloqueia teclado e mouse para o jogo; alternância por hotkey).
- Janelas são `OverlayBrowserWindow` criadas por `createWindow(OverlayWindowOptions)`; opções: `passthrough` (`noPassThrough` padrão, `passThrough`, `passThroughAndNotify`), `zOrder`, `ignoreKeyboardInput`, `dpiAware`, `strictToGameWindow`, `useSharedTexture` (beta, ≥ 2.0.2), `disableHardwareAcceleration`. Fluxo: `registerGames(filter)` → evento `game-launched` → `event.inject()` → `game-injected` → criar janelas. Hotkeys próprios em `overlay.hotkeys`. `installHighElevationHelper()` pede UAC para jogos elevados. ([IOverwolfOverlayApi](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/interfaces/IOverwolfOverlayApi/), [OverlayWindowOptions](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/interfaces/OverlayWindowOptions/), [PassthroughType](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/type-aliases/PassthroughType/))
- **Renderização:** textura compartilhada GPU só em jogos D3D11/D3D12 ("Not supported: D3D9, OpenGL, and Vulkan"); caso contrário cópia por CPU. Janelas com textura compartilhada capturam o mouse no retângulo inteiro, inclusive pixels transparentes ([shared-texture-rendering](https://dev.overwolf.com/ow-electron/reference/examples/overlay/shared-texture-rendering)).
- **Isso é injeção.** A doc não descreve o mecanismo ("The page doesn't explain how injection works"), mas usa a palavra "inject"/"injected" na API, e o log local mostra `owe-client-x64.dll` injetada no PID do TFT (canais-locais). [DOC] + [MEDIDO]
- Observação: o log local mostra injeção do overlay "rejeitada" em dois momentos (00:17 e 00:27 de 10/10) sem causa conhecida (canais-locais). Não investigado.

### 4.3 Opções para mostrar

#### B1. Interface web v2 em outra janela ou monitor (status quo)

- **Entrega:** tudo que o v2 já mostra. **Esforço:** zero. **Risco:** nenhum novo. **Limite:** exige olhar para outro lugar; sem sobreposição. Cabe: sim.

#### B2. Edge Game Assist fixado sobre o jogo

- **Entrega:** uma janela do Edge dentro do Game Bar que fica sobre o jogo: "Select the Pin icon in the Game Assist title bar, and the widget stays on top of your game after you close Game Bar. ... You can also resize, move, and adjust the transparency of the widget." ([FAQ Microsoft](https://support.microsoft.com/en-us/edge/microsoft-edge-game-assist-faq))
- **Passos:** Edge 137+ com Windows 11 22H2+ e Game Bar atualizado; instalar Game Assist nas configurações do Edge; Win+G → Game Assist → abrir `http://127.0.0.1:3218/` (v2) → Pin; ajustar transparência. [DOC]; **a FAQ não trata de URL localhost, de anti-cheat nem de fullscreen** → [NÃO TESTADO].
- **Esforço:** minutos, sem código. **Requisitos:** Windows 11, Edge, Game Bar habilitado. **Risco Riot:** não encontrei texto; é software Microsoft sem injeção do helper. Uma fonte de terceiros recomenda fechar Game Bar antes de iniciar o VALORANT por conflitos com o Vanguard (aconselhamento de site de ajuda, não da Riot; LoL/TFT não verificado) [SECUNDÁRIO]. **Manutenção:** nula. Cabe: sim (nenhum pacote). Interação: o widget aceita clique; durante a partida, clicar nele tira o foco do jogo [INFERÊNCIA].
- Limitações: "Widget automatically closes after a period of inactivity" (relato de terceiro na busca) e a lista de jogos "aprimorados" só afeta dicas, não o funcionamento.

#### B3. Document Picture-in-Picture (janela HTML sempre no topo, sem instalar nada)

- **Entrega:** uma mini-janela HTML flutuante controlada pela página do v2. "always-on-top window that can be populated with arbitrary HTML content"; Chrome/Edge 116+, Firefox 151 ([Chrome docs](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)).
- **Passos:** botão no v2 chama `documentPictureInPicture.requestWindow({width,height})` num clique; copiar o DOM/estilos para a janela (os estilos são copiados uma vez; o `copyStyleSheets` não é mais suportado, precisa clonar manualmente) e redesenhar o conteúdo nela.
- **Restrições do spec:** `[SecureContext]` (127.0.0.1 é "Potentially Trustworthy", logo qualifica [DOC W3C Secure Contexts, intervalo 127.0.0.0/8]); exige ativação transitória do usuário (NotAllowedError sem gesto); o site não escolhe a posição (`moveTo/moveBy` desativados), não pode entrar em tela cheia, não sobrevive à janela que a abriu, redimensionar exige gesto ([WICG spec](https://wicg.github.io/document-picture-in-picture/)).
- **Esforço:** ~0,5 dia de JS no v2 (mantendo "sem build"). **Risco:** como B1/B2 (navegador comum, sem injeção). **Não testado** sobre o TFT; a aba que abre precisa continuar aberta (não minimizada/descartada). Cabe: sim, é o único que não depende de nada fora do navegador. Não é click-through (cobre uma área do jogo que o usuário posiciona).

#### B4. PowerToys "Always On Top" sobre uma janela do navegador em modo app

- **Entrega:** fixa qualquer janela (ex.: `msedge --app=http://127.0.0.1:3218/` [conhecimento prévio, não reverificado]) sobre as outras com Win+Ctrl+T. A doc diz que a janela fixada deve ficar acima das não-topmost mesmo desativada, mas "can't guarantee" estar acima de outras topmost; **há opção "Do not activate when Game Mode is on"** (desligada por padrão; ligue o atalho antes da partida) ([Learn PowerToys](https://learn.microsoft.com/en-us/windows/powertoys/always-on-top)).
- **Esforço:** minutos. **Requisitos:** instalar PowerToys (software Microsoft, mas é instalação de terceiros fora do repositório). **Risco/manutenção:** baixos. **Não testado** com TFT. Cabe: sim (não toca o projeto).

#### B5. Janela transparente click-through própria (Electron, sem Overwolf)

- **Entrega:** HUD desenhado sobre o jogo, sem moldura, que deixa o clique passar para o jogo, ancorado à janela do TFT.
- **Mecânica [DOC Electron]:** `new BrowserWindow({transparent:true, frame:false, focusable:false, skipTaskbar:true})`; `win.setAlwaysOnTop(true, 'screen-saver')` (níveis `normal…screen-saver`; de `floating` a `status` fica abaixo da barra de tarefas no Windows); `win.setIgnoreMouseEvents(true, {forward:true})` ("forward" só em Windows/macOS) e alternar para `false` quando o ponteiro entra num elemento interativo (padrão com IPC/preload, descrito na doc de interações). Hotkeys globais com `globalShortcut` (só no processo principal, após `ready`; "If another application already holds an accelerator, register ... fail silently"). A janela carrega `http://127.0.0.1:3218/overlay` (a interface web atual, em modo HUD).
- **Alinhar à janela do jogo:** `electron-overlay-window` (SnosMe, MIT, v4.1.0, atualizado 2026-04-15) acha a janela por título e acompanha posição/tamanho; limitações: um overlay só, inicializar uma vez, plataformas "Windows 7 to 10, Linux X11"; o README lido não detalha o mecanismo nem o fullscreen exclusivo, e não diz se injeta ([github](https://github.com/SnosMe/electron-overlay-window)). Pacote nativo (addon), portanto pesa ainda mais em dependências.
- **Esforço:** 1–2 dias (janela, IPC de click-through, hotkey de mostrar/ocultar, ancoragem). **Requisitos:** o pacote `electron` (≈44.7.0 hoje; binário de ~100 MB+ baixado no postinstall [INFERÊNCIA]), Node 22.12+ (o Electron pede), um launcher para rodar o servidor + Electron. **Risco Riot/anti-cheat:** sem injeção, sem leitura de memória; precedentes: Blitz e OP.GG Desktop são apps Electron com overlay em jogo ("Shift+Tab" no OP.GG; segundo o ranking de um vendor concorrente, hexgate.app, 2026-09-16) [VENDOR, mecanismo de desenho não confirmado]; TFTSense é um app Windows sem Overwolf "just another window sitting on top of your screen" [VENDOR]. Nenhum é aprovação da Riot (nota 07). **Manutenção:** média (atualizar Electron; vigiar mudanças do cliente Unreal). **Cabe no projeto:** só como decisão do usuário (nova dependência pesada, contra "sem build/deps mínimas"); alternativa que mantém Node puro é B6.

#### B6. Janela Win32 "sem pacote": estilos aplicados à janela do Edge por PowerShell (idéia, não testada)

- **Ideia:** abrir `msedge --app=...` e, por P/Invoke em PowerShell (sem instalar nada), aplicar na janela do Edge `WS_EX_LAYERED` + `SetLayeredWindowAttributes` (transparência), `WS_EX_TRANSPARENT` (click-through) e `SetWindowPos(HWND_TOPMOST)` + `WS_EX_NOACTIVATE`/`WS_EX_TOOLWINDOW` ([Learn: Extended Window Styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)). É o que o PowerToys faz para o topmost, e o Game Assist faz de forma suportada.
- **Estado:** puramente teórico para o nosso caso: não achei exemplo que funcione com janelas do Chromium; a janela é do Edge, não do jogo, e o Chromium pode reaplicar estilos. [NÃO TESTADO] [INFERÊNCIA]. Esforço: 0,5–1 dia de experimento. Risco: nenhum sobre o jogo (não toca o processo do TFT), mas script que mexe em janelas alheias é frágil. Cabe: sim (arquivo `.ps1` + `.mjs`), mas só depois de B2/B3 falharem.

#### B7. Pacote `overlay` do ow-electron/Overwolf (injeção)

- **Entrega:** sobreposição renderizada pelo próprio Overwolf no quadro do jogo, com modos standard/exclusive, hotkeys do Overwolf, e funciona também em fullscreen quando suportado (a doc só garante isso para outros jogos).
- **Passos/requisitos:** os de A2 (mesma conta/aprovação/credenciais) + `registerGames({gamesIds:[28164,21570], all:false})`, `game-launched` → `event.inject()`, `createWindow({name, passthrough, zOrder, transparent...})`, hotkeys. **Esforço:** 2–3 dias sobre A2. **Risco:** injeção no processo do TFT pelo código Overwolf (mesma que MetaTFT/Mobalytics/TFTAcademy já fazem); não adiciona aprovação Riot ao helper. **Manutenção:** alta. **Cabe:** não recomendado: mesmo bloqueio de elegibilidade de A2 e o único ganho (fullscreen) é dispensável com o TFT já em janela (ini medido).

#### B8. Segundo dispositivo (celular/tablet)

- **Entrega:** HUD fora do PC do jogo. O servidor hoje escuta em 127.0.0.1; abrir para a LAN é decisão de segurança do usuário (autenticação, firewall). Esforço baixo (flag de bind + token). Risco Riot: nenhum (outro dispositivo). Cabe: sim, opcional.

#### B9. Atalhos globais (para mostrar/ocultar o HUD sem tirar o foco do jogo)

| Opção                                                                   | Funciona sobre o jogo?        | Observação                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `globalShortcut` do Electron                                            | sim (registro do SO)          | falha silenciosa se outro app já tem a combinação; exige Electron                                 |
| Hotkeys do Overlay Overwolf                                             | sim                           | só dentro do pacote overlay                                                                       |
| Win+G / Win+Ctrl+T                                                      | sim                           | do Game Bar / PowerToys (B2/B4)                                                                   |
| Teclado dentro da página (`keydown`)                                    | não, só com foco no navegador | inútil durante a partida                                                                          |
| Gancho de teclado de baixo nível (`SetWindowsHookEx`) em script externo | tecnicamente sim              | **não encontrei** texto da Riot nem do Vanguard sobre isso; evitar por precaução [INFERÊNCIA]     |
| `RegisterHotKey` via PowerShell/AutoHotkey                              | sim em princípio              | API de registro de atalho do SO; **não pesquisei** o comportamento com o Vanguard [NÃO ENCONTREI] |

---

## 5. Matriz comparativa

| Opção                         | Entrega                                 | Esforço               | Credenciais/aprovação                                                | Risco política Riot (do canal) | Risco técnico anti-cheat                               | Manutenção | Novo pacote?                      |
| ----------------------------- | --------------------------------------- | --------------------- | -------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ | ---------- | --------------------------------- |
| A1 banco TFTAcademy           | eventos próprios                        | feito                 | nenhuma (no helper)                                                  | conteúdo (nota 07)             | nenhum no helper                                       | média-alta | não                               |
| A2 ow-electron Dev Mode (GEP) | eventos                                 | 2–4 d + espera        | conta Overwolf + ideia aprovada + OW_DEV_KEY; "private" não aprovado | conteúdo + regras Overwolf     | injeção do Overwolf                                    | alta       | **sim (`@overwolf/ow-electron`)** |
| A3 app Overwolf nativo        | eventos                                 | 1–2 d + espera        | whitelist                                                            | idem                           | idem                                                   | média      | não (artefato à parte)            |
| B1 janela web                 | HUD fora do jogo                        | 0                     | nenhuma                                                              | conteúdo                       | nenhum                                                 | nula       | não                               |
| B2 Edge Game Assist (Pin)     | HUD sobre o jogo                        | minutos               | nenhuma                                                              | conteúdo                       | sem injeção do helper; compat. Vanguard não verificada | nula       | não                               |
| B3 Document PiP               | mini-HUD sempre no topo                 | ~0,5 d                | nenhuma                                                              | conteúdo                       | nenhum                                                 | baixa      | não                               |
| B4 PowerToys AOT              | idem B1 + topo                          | minutos               | nenhuma                                                              | conteúdo                       | nenhum                                                 | nula       | não (app MS)                      |
| B5 Electron click-through     | HUD sobre o jogo, click-through, hotkey | 1–2 d                 | nenhuma                                                              | conteúdo                       | sem injeção; janela de outro processo                  | média      | **sim (`electron`)**              |
| B6 Win32/PowerShell           | idem B5 mais frágil                     | 0,5–1 d (experimento) | nenhuma                                                              | conteúdo                       | nenhum no jogo                                         | alta       | não                               |
| B7 overlay Overwolf           | HUD injetado                            | 2–3 d sobre A2        | como A2                                                              | conteúdo                       | injeção                                                | alta       | **sim**                           |
| B8 outro dispositivo          | HUD externo                             | baixo                 | nenhuma                                                              | conteúdo                       | nenhum                                                 | baixa      | não                               |

---

## 6. Recomendação ordenada

**Eventos (A):**

1. **Manter A1** (TFTAcademy → `gep-reader.mjs`). Rodar uma partida longa para fechar as lacunas (latência em ms, ouro/loja reais) antes de investir em outro canal.
2. **Perguntar à Overwolf** (e-mail citado na doc: developers@overwolf.com) se um app estritamente pessoal, sem ads/assinatura e sem publicação, pode receber `OW_DEV_KEY`. Resposta pública atual: "doesn't approve private apps". Só depois disso considerar A2/A3. Não registrar o app como público com monetização que não existe.
3. Não investir em injeção própria, leitura de memória nem em reimplementar o plugin (nota 07).

**Exibição (B), do mais barato ao mais caro:**

1. **B1** (já) + **B2** (Edge Game Assist fixado) como primeiro teste de sobreposição; deve ser feito com o TFT em janela/janela sem borda (o ini local já mostra `FullscreenMode=2`).
2. **B3** (Document PiP) se o B2 falhar ou o usuário quiser HUD compacto controlado pelo v2; sem dependência nova.
3. **B4** (PowerToys) como atalho de topo para a janela `--app`.
4. **B5** (Electron click-through) só se B2–B4 não bastarem e o usuário aceitar `electron` como dependência.
5. **B6** só como experimento; **B7** não recomendado.

**Decisões que cabem ao usuário:**

- Adicionar `electron` (ou `@overwolf/ow-electron`) ao projeto, rompendo "sem build/deps mínimas"? (B5, A2, B7)
- Pedir à Overwolf uma exceção para uso pessoal, e aceitar a resposta (e não fingir app público)?
- Continuar dependendo de Overwolf+TFTAcademy abertos e do esquema privado do banco (A1)? Alternativa: nenhuma legítima sem aprovação.
- Colocar o TFT em janela ou janela sem borda para permitir qualquer sobreposição (hoje já está em `FullscreenMode=2`)?
- Permitir testes de B2/B3/B4 no jogo real (nenhum foi testado), registrando se o Vanguard/Game Bar reclamam.
- Se quer o servidor acessível na LAN para tablet/celular (B8), com qual proteção.
- Quanto de conteúdo ao vivo exibir no HUD (nota 07, seção 4); mudar o canal de exibição não muda o risco de política do conteúdo.
- Perguntar à Riot por escrito sobre overlays que não injetam; hoje não há texto publicado.

---

## 7. Regras de decisão acionáveis

- SE o objetivo é obter GEP num app pessoal sem publicar ENTÃO começar por A1 e consultar a Overwolf antes de qualquer trabalho com ow-electron PORQUE o Dev Mode exige status "Approved"/QA aprovado e a doc diz "doesn't approve private apps" [dev-mode; project-roadmap].
- SE a DevRel da Overwolf aprovar `OW_DEV_KEY` ENTÃO usar ow-electron com `setRequiredFeatures` explícito (`me, store, bench, match_info, roster`), nunca `null`, e sem `augments` PORQUE `null` assina todas as features, incluindo `augments` (proibido pela Overwolf) e dados de rivais [doc TFT Overwolf; sample usa `null`].
- SE o GEP falhar no meio da partida ENTÃO ler `getInfo(28164)` (e 21570) ao reabrir PORQUE eventos anteriores se perdem e a doc recomenda indicar o dado como não confiável [GEP intro].
- SE a sobreposição for exigida sem injeção ENTÃO exigir o TFT em janela ou janela sem borda (ini: `FullscreenMode` 2 ou 1) e fazer o HUD detectar isso PORQUE fullscreen exclusivo esconde janelas de outros apps [Learn DXGI; Overwolf para CS/Warzone/Destiny].
- SE B2 for adotado ENTÃO ajustar transparência e posição para não cobrir a loja/banco/tabuleiro e testar o clique do widget (tira o foco do jogo) PORQUE o Game Assist é uma janela do Edge clicável [FAQ].
- SE usar Document PiP ENTÃO abrir por clique do usuário e manter a aba-mãe aberta PORQUE o spec exige gesto e a janela PiP não sobrevive à aba [WICG].
- SE usar Electron click-through ENTÃO alternar `setIgnoreMouseEvents` por IPC nos elementos interativos PORQUE ignorar mouse corta o `mouseleave` e o `forward` serve para recuperar eventos [Electron docs].
- SE o Vanguard bloquear ou avisar algo ao abrir B2/B4/B5 ENTÃO parar e registrar a mensagem PORQUE não há allow list ("absolutely no allow list for Vanguard") [Vanguard FAQ].
- SE o objetivo for evitar qualquer risco técnico ENTÃO ficar em B1/B8 PORQUE são janelas/dispositivos separados sem relação com o processo do jogo.
- SE a Riot publicar regras sobre o cliente Unreal (alvo 2026-11-03) ou sobre overlays ENTÃO reavaliar todas as opções PORQUE nenhuma regra publicada cobre APIs locais ou sobreposição nesse cliente [nota 07].

---

## 8. Números de referência

- `@overwolf/ow-electron` 42.11.4 (2026-10-04, MIT); `@overwolf/ow-electron-packages-types` 1.1.12; Electron oficial 44.7.0 (`npm view`, hoje); `electron-overlay-window` 4.1.0 (2026-04-15, MIT).
- Dev Mode: ow-electron ≥ 39.8.10, ow-electron-builder ≥ 26.9.0, Windows. Overlay ≥ 1.7.0 (`dpiAware`), 1.9.0 (`strictToGameWindow`), 2.0.2/2.0.5 (`useSharedTexture`), 2.0.9 (correção admin), agosto/2026.
- Textura compartilhada: D3D11 e D3D12 apenas.
- Requisitos do cliente Unreal do TFT: Windows 10 19041+, DirectX 11 FL 4.3, Shader Model 5; lançamento 2026-11-03.
- Edge Game Assist: Edge 137+, Windows 11 22H2+; Document PiP: Chrome/Edge 116+, Firefox 151.
- Memória (Riot): vigência 2026-10-06; carência até abril/2027 para ferramentas "known and currently approved".
- Local: TFT `FullscreenMode=2`, 1920x1080, 120 fps (ini, 2026-10-10).

---

## 9. Como isso se aplicaria a um assistente de decisão

| Parte                              | Dados que o sistema precisa                                                                                    | Observação                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receber eventos (A1/A2/A3)         | origem do dado (GEP/arquivo), idade em segundos, `gepStatus`, `matchState`, identidade do jogador local        | já existentes; `gep-reader` marca desconhecido em vez de inventar; adicionar um campo "canal" (banco TFTAcademy, ow-electron) se um dia houver dois |
| Escolher o que exibir sobre o jogo | estágio-rodada (`round_type.stage`), `shopVisible`, ouro, nível/XP, HP, fase (combate × planejamento)          | para ocultar o HUD durante combate/PvE se o usuário quiser; vem de `match_info`                                                                     |
| Posição do HUD                     | tamanho e posição da janela do TFT, modo de janela (`FullscreenMode`), DPI/escala, monitor                     | o servidor pode ler o ini somente leitura; posição vem da janela (Electron/`electron-overlay-window`) ou é configurada à mão em B2/B3               |
| Não cobrir o jogo                  | regiões de loja, banco de campeões, banco de itens, tabuleiro no layout 1920x1080 (e escalonadas)              | preciso medir no cliente real; não achei coordenadas oficiais                                                                                       |
| Hotkey de mostrar/ocultar          | combinação configurável, estado do HUD                                                                         | `globalShortcut` (Electron) ou Win+G/Win+Ctrl+T                                                                                                     |
| Conformidade                       | lista de campos de rivais e de aprimoramentos a descartar na origem, e flag "modo conteúdo estático" (nota 07) | decisão do usuário; o canal de exibição não muda isso                                                                                               |
| Diagnóstico                        | `Pinned` do Game Assist, `isSharedTextureAvailable`/`game-injected` (se Overwolf), erros de abertura do PiP    | para dizer ao usuário "sobreposição indisponível; usar janela"                                                                                      |

---

## 10. Lacunas

- **Nenhuma opção de exibição sem injeção foi testada com o TFT**: Game Assist com URL localhost, PiP sobre o TFT, topmost sobre o cliente Unreal em janela sem borda, comportamento do Vanguard com cada uma. Sugestão: com uma partida real, testar B2, B3 e B4 em sequência e registrar se a janela aparece, se o foco do jogo é perdido e se há aviso do Vanguard.
- Não confirmei quais modos de janela o menu do cliente Unreal novo oferece (só o ini local).
- Não confirmei se o Dev Mode do ow-electron exige o cliente Overwolf instalado, nem se funciona para o TFT sem aprovação por jogo; a doc do Dev Mode não cobre admin, timeouts, nem restrições por jogo.
- Não consegui abrir `discuss.overwolf.com` (a resolução DNS falhou), então as respostas antigas de staff sobre uso pessoal vêm só de resumo de busca.
- Não achei documento da Riot sobre overlays que não injetam, nem sobre janelas sempre-no-topo ou captura de tela; Backgrind/TFTSense/MetaBot são vendors.
- Não verifiquei o mecanismo de desenho de Blitz/OP.GG/TFTSense, nem como a `electron-overlay-window` lida com fullscreen exclusivo (README lido não explica).
- Não medi tamanho de instalação do binário do Electron/ow-electron (estimativa).
- A página da Overwolf sobre modos de exibição (in-game-overlays) contradiz a si mesma quanto ao modo janela e captura; não resolvi.

## 11. Fontes (lidas em 2026-10-10)

- ow-electron: [technical overview](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-technical-overview) · [FAQ](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq) · [first-app](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/first-app) · [Dev Mode](https://dev.overwolf.com/ow-electron/guides/dev-tools/dev-mode/) · [App Signing](https://dev.overwolf.com/ow-electron/guides/dev-tools/app-signing/) · [changelog](https://dev.overwolf.com/ow-electron/getting-started/changelog/ow-changelog) · [overlay overview](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/Overview) · [IOverwolfOverlayApi](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/interfaces/IOverwolfOverlayApi/) · [OverlayWindowOptions](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/interfaces/OverlayWindowOptions/) · [PassthroughType](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/type-aliases/PassthroughType/) · [shared texture](https://dev.overwolf.com/ow-electron/reference/examples/overlay/shared-texture-rendering) · [in-game overlays](https://dev.overwolf.com/ow-electron/guides/product-guidelines/app-screen-behavior/in-game-overlays) · [sample app](https://github.com/overwolf/ow-electron-packages-sample)
- Overwolf nativo e compliance: [project roadmap](https://dev.overwolf.com/ow-native/getting-started/project-roadmap/) · [setting up dev environment](https://dev.overwolf.com/ow-native/getting-started/onboarding-resources/setting-up-dev-environment) · [TFT events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics/) · [GEP intro](https://dev.overwolf.com/ow-native/live-game-data-gep/live-game-data-gep-intro) · [TFT compliance](https://dev.overwolf.com/ow-electron/guides/game-compliance/teamfight-tactics) · [blog sobre anúncios](https://blog.overwolf.com/supporting-creators-in-riots-ecosystem-our-response-and-commitment/) · [native changelog](https://dev.overwolf.com/ow-native/getting-started/changelog/ow-changelog/) · [TFT-OpenOverlay PR 7](https://github.com/daKires/TFT-OpenOverlay/pull/7)
- Riot: [Vanguard FAQ](https://www.riotgames.com/en/DevRel/vanguard-faq) · [FAQ migração Unreal](https://support.riotgames.com/en-us/tft/client/tft-unreal-engine-migration-faq) · [Developer Policy](https://developer.riotgames.com/policies/general) · [acesso à memória](https://support.riotgames.com/en-us/riot/performance/game-memory-access-removed-for-third-party-apps)
- Janelas e navegador: [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) · [Electron click-through](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions) · [globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut) · [electron-timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) · [electron-overlay-window](https://github.com/SnosMe/electron-overlay-window) · [Document PiP (Chrome)](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) · [Document PiP (spec)](https://wicg.github.io/document-picture-in-picture/) · [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) · [Edge Game Assist FAQ](https://support.microsoft.com/en-us/edge/microsoft-edge-game-assist-faq) · [PowerToys Always On Top](https://learn.microsoft.com/en-us/windows/powertoys/always-on-top) · [Extended Window Styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles) · [DXGI flip model](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model) · [Epic WindowMode](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/WindowMode)
- Vendors (VENDOR): [TFTSense](https://tftsense.gg/study-hall/are-tft-overlays-safe/) · [Backgrind](https://backgrind.com/overlay-anticheat-checker/league-of-legends/) · [Hexgate](https://hexgate.app/blog/lol-overlay-without-overwolf/)
- Locais: `%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\GameUserSettings.ini`, `tft/helper/gep-reader.mjs`, `tft/helper/FONTES-DE-DADOS.md`, `npm view` (2026-10-10).

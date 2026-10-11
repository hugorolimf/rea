# TFT Compass · design system e decisões de interface

Documento vivo da interface (`tft/helper/v2/`). Galeria visual dos componentes, sem servidor: abra `v2/gallery.html` direto do disco.

## 1. Decisão de tecnologia

**Mantemos módulos ESM sem build e CSS moderno, sem biblioteca de componentes.** Nenhuma dependência foi adicionada.

| Opção avaliada                           | Decisão   | Motivo                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preact + htm / Lit para os componentes   | Não       | O modelo (`model.js`) e os módulos de texto rico (`rich-text.js`, `glyphs.js`) produzem **strings de HTML** que o overlay Electron (`overlay/hud/`) reaproveita; trocar por componentes quebraria o compartilhamento. A reconciliação por chave (`dom.js`) já evita redesenho completo. Sem build, sem JSX. |
| Biblioteca de ícones (Lucide, Phosphor)  | Não       | O sprite SVG inline em `index.html` (~30 símbolos, 24 px, traço de 1,8) cobre tudo, não faz requisição, herda `currentColor` e cabe nos dois temas.                                                                                                                                                         |
| Biblioteca de gráficos (uPlot, Chart.js) | Não       | O único gráfico é a curva "ouro × chance" (SVG de 280×104 gerado em `ui/panel.js` com `monotonePath`); uma biblioteca pesaria mais que o gráfico.                                                                                                                                                           |
| Fonte web (Inter)                        | Não       | App offline em localhost: a pilha de sistema (`Segoe UI Variable`) carrega sem requisição e sem troca de layout.                                                                                                                                                                                            |
| CSS moderno nativo                       | **Sim**   | `@layer`, aninhamento, `light-dark()`, `color-mix()`, OKLCH, `@container`, `@starting-style`, `<dialog>`, Popover API, `:has()`, `@property`. Tudo com suporte em Chromium 123+ / Edge / Firefox 120+ / Safari 17.5+ (o overlay usa o Chromium do Electron).                                                |
| View Transitions                         | Não       | A tela se atualiza a cada 5 s e as peças já animam por FLIP com mola (`dom.js`); uma transição global brigaria com isso. A troca de tela usa só uma entrada com `@keyframes` (respeita `prefers-reduced-motion`).                                                                                           |
| Anchor positioning (CSS)                 | Não ainda | Suporte ainda irregular; as dicas usam a Popover API com posição calculada (`ui/tooltip.js`, função pura `placeTip`).                                                                                                                                                                                       |

Se um dia uma biblioteca entrar, vendorize em `v2/vendor/<nome>@<versão>/` com a licença ao lado (sem CDN) e documente nome, versão, motivo, tamanho e licença aqui. Hoje a tabela de dependências é vazia.

## 2. Compatibilidade com o servidor

O contrato não mudou: `GET /api/state`, `POST /api/recommend`, `GET /api/catalog|comps|items|history`, `GET /api/events` (SSE) e `GET /api/overlay`. O que mudou no cliente:

- `recommendPayload` não aceita mais `legacyServer` (servidor anterior ao M7). O servidor atual lê ouro, nível e itens do próprio estado; o corpo do POST ao vivo só leva decisões.
- Erros de rede viram `Error` com `network: true`; respostas 4xx/5xx trazem `status`. Isso alimenta o estado de conexão.
- `subscribe(onEvent, onStatus)` informa `"open"`/`"closed"` do SSE.
- `static-files.mjs` serve também `/sw.js` e `/manifest.webmanifest` (arquivos de `v2/`) e os tipos `.webmanifest` e `.png` (ícones). Nenhuma rota de API mudou.

## 3. Camadas de CSS e arquivos

```
@layer reset, tokens, base, layout, components, motion;
```

| Arquivo              | Camada      | Conteúdo                                                                                                                        |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `css/tokens.css`     | tokens      | Cor (claro/escuro), tipografia, espaço, raio, sombra, z-index, geometria, movimento                                             |
| `css/base.css`       | reset, base | Reset, corpo, foco, `.i`, `.eyebrow`, `.sr`, `.num`, movimento reduzido                                                         |
| `css/shell.css`      | layout      | Grade do app, barra, navegação, palco, `.view`, "Foco agora", aviso, grade do Ao vivo, estados                                  |
| `css/components.css` | components  | Botão, chip, score, tier, retrato `.pt`, cartão, campos, segmentado, abas, tabela, estado, pílula, diálogo, dica, toast         |
| `css/<área>.css`     | components  | Só o que é da área: `hud`, `field`, `panel`, `plan`, `augs`, `subs`, `comps`, `comp-modal`, `items`, `history`, `ended`, `rich` |

Ordem de carga em `index.html`: tokens, base, shell, components, depois as áreas. Regra: componente compartilhado nasce em `components.css`; a área só acrescenta o que é dela. Nada de cor, raio ou sombra literal fora de `tokens.css`.

## 4. Tokens (resumo)

- **Tema**: `color-scheme: light dark` segue o sistema; `<html data-theme="light|dark">` (Ajustes, atalho `T`, `?theme=` na URL) força um. Pares com `light-dark()`.
- **Cor**: superfícies `--bg --bg-sunken --surface --surface-2 --surface-3`, linhas `--line --line-soft`, texto `--text --muted --faint`. Semânticas `--go --amber --violet --blue --gold --danger` servem a **texto, traço e contorno**; os fundos sólidos são `--go-fill` etc., sempre com `--on-fill` por cima (nunca texto claro sobre `--x`). Custo: `--cost-1..5`.
- **Tipografia**: `--font`, `--font-display`; escala `--fs-2xs 10 / xs 11 / sm 12 / md 14 / lg 16 / xl / 2xl / hero` (os três maiores fluidos com `clamp`). Números sempre `tabular-nums`.
- **Espaço**: `--sp-1..8` (4, 8, 12, 16, 20, 24, 32, 48). **Raio**: `--r-xs 6, sm 8, md 12, lg 16, pill`; `--radius` (14) para cartões.
- **Sombra**: `--shadow-1` (cartão), `--shadow-2` (flutuante), `--shadow-pop` (diálogo).
- **Movimento**: `--dur-1/2/3` (120/200/360 ms), `--ease-out`, molas `--spring-*`/`--settle-*` (publicadas por `dom.js`; zero com movimento reduzido).
- **Camadas z**: `--z-sticky 10 < --z-nav 20 < --z-popover 40 < --z-dialog 50 < --z-toast 60`.

## 5. Componentes (classes) e contratos

Todos nascem em `css/components.css` (exemplos vivos em `gallery.html`).

| Componente       | Marcação                                                                                                              | Notas                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Botão            | `<button class="btn [btn-go\|btn-solid\|btn-quiet\|btn-danger] [btn-sm\|btn-icon]">`                                  | `btn-solid` = ação principal (uma por tela). Ícone sozinho exige `aria-label`. 40 px em toque.                             |
| Link-botão       | `<button class="link">`                                                                                               | Ação secundária dentro de frase.                                                                                           |
| Chip             | `<span class="chip" data-tone="go\|gold\|amber\|blue\|violet\|danger">` (também `chip-go/-best/-amber`)               | Rótulo curto; nunca é o único canal de uma informação (some cor + ícone/texto).                                            |
| Score / Tier     | `<span class="score" data-band="high\|mid\|low\|none">`, `<span class="tier tier-S">`                                 | Fundo sólido + `--on-fill`.                                                                                                |
| Retrato          | `portrait()` em `ui/glyphs.js` → `<span class="pt" style="--s:28px;--ring-c:var(--cost-3)">`                          | Anel = custo; item usa `pt-item`. Imagem com `width/height`, `loading=lazy`, `decoding=async`; sem imagem mostra iniciais. |
| Texto rico       | `richText()`/`nameChip()` em `ui/rich-text.js`                                                                        | Regra de produto: nenhum nome de campeão/item só como texto (guardado por `names-guard.test.mjs`).                         |
| Cartão           | `<div class="card" [data-tone="go\|amber\|danger"]>`                                                                  | `section-head` abre cada bloco da tela.                                                                                    |
| Campo            | `input[type=search]`, `select` (estilo base)                                                                          | 42 px e fonte 16 px em toque (sem zoom no iOS).                                                                            |
| Segmentado       | `<div class="seg" role="group"><button aria-pressed>`                                                                 | Escolha única, poucas opções.                                                                                              |
| Abas             | `<ul class="tabs"><li><button aria-current="true">`                                                                   | Troca de conteúdo dentro de uma tela.                                                                                      |
| Interruptor      | `<label class="switch"><input type="checkbox">`                                                                       |                                                                                                                            |
| Tabela           | `<div class="tbl-wrap"><table class="tbl">`                                                                           | Número à direita com `data-num`.                                                                                           |
| Estado           | `<section class="state" [data-tone="danger"]>` com ícone, título e ação                                               | Vazio, erro e "sem dados": sempre diz o que aconteceu e o que fazer.                                                       |
| Pílula           | `<span class="pill" data-tone="ok\|warn\|bad" [data-pulse]>`                                                          | Conexão, fonte, partida.                                                                                                   |
| Diálogo          | `<dialog class="dlg"><div class="dlg-box"><header class="dlg-head">…<div class="dlg-body">…<footer class="dlg-foot">` | `showModal()`; abaixo de 640 px vira folha embaixo. Foco preso e Esc nativos; devolva o foco a quem abriu.                 |
| Dica             | atributo `title="…"` (aceita `\n`)                                                                                    | `ui/tooltip.js` troca por uma dica estilizada em hover, foco por teclado e toque longo; Esc fecha.                         |
| Aviso temporário | `shell.toast(texto, { action })`                                                                                      | Não é anunciado sozinho; use `shell.announce()` quando importar.                                                           |
| Anúncio          | `shell.announce(texto)`                                                                                               | Região `aria-live="polite"`: avisos de compra/nível, conexão, tema.                                                        |

## 6. Casca, telas e roteamento

```
.app (grade)  ── .appbar: marca · pílula de conexão · instalar · tema · ajustes
              ── .nav (trilho à esquerda ≥ 760 px; barra embaixo < 760 px): Ao vivo · Comps · Itens · Histórico
              ── .stage (rola; container "stage")
                   ├─ #view-live: .live-top (HUD + "Foco agora", fixo) · aviso · disputa · .deck · estados
                   ├─ #comps   ├─ #items   └─ #history
```

| Endereço                           | Tela                                          |
| ---------------------------------- | --------------------------------------------- |
| `#ao-vivo` (ou vazio, `#`)         | Ao vivo                                       |
| `#comps` · `#itens` · `#historico` | Comps · Itens · Histórico                     |
| `#partida/<id>`                    | Ao vivo revendo a partida `<id>` (só leitura) |

Atalhos: `1` a `4` (telas), `M` (comp sugerida), `T` (tema), `?` (ajustes e atalhos), `Esc`. Lógica pura em `js/router.js`.

**Grade do Ao vivo** (`.deck`, por container query do palco): ≥ 1180 px três colunas `Agora | Painel | Formação`; ≥ 760 px `Agora | Painel` e a Formação embaixo; abaixo, uma coluna na ordem de urgência (Agora, Painel, Formação). A coluna da Formação flui em colunas CSS (`columns: 380px`), então as seções se distribuem sozinhas conforme a largura. O Painel gruda abaixo do topo fixo e rola dentro do próprio cartão.

**Topo fixo** (`.live-top` = HUD + "Foco agora"): gruda em janelas com mais de 640 px de altura e se o ajuste "Topo fixo" estiver ligado. Em palco estreito (≤ 640 px: janela ao lado do jogo, celular) só a faixa "Foco agora" gruda, em uma linha rolável de lado com a decisão mais urgente à esquerda; o HUD rola junto com o resto (um HUD inteiro fixo comeria metade da tela).

**Hierarquia por urgência**: 1) "Foco agora" (`js/focus.js`: comprar na loja, subir, rolar ou não, trocar, equipar, em uma linha); 2) lista "Agora" e Painel (nível, roll, loja); 3) Formação, Plano, Aprimoramentos, Substituições, Itens.

## 7. App web e offline

- `manifest.webmanifest` (instalável, atalhos para as telas), ícones em `v2/icons/`, `sw.js` servido em `/sw.js`.
- Service worker: **nunca** toca em `/api/*`, `/overlay/*`, `/live-mock*`. Casca (`/`, `/v2/*`, `/core/*`): rede primeiro, cópia local se a rede falhar ou passar de 4 s. Imagens do catálogo e ícones: cache primeiro. A página manda ao worker o que já carregou (`CACHE_URLS`), então a segunda abertura já funciona offline. Versão nova só entra quando o usuário clica em "Atualizar" (nunca recarrega no meio da partida).
- Sem rede ou com o servidor parado: a interface abre, a pílula mostra "Servidor indisponível" com o tempo até a próxima tentativa (recuo 5, 10, 20, 30 s), a última leitura continua na tela e a análise do servidor segue rodando sozinha (M10b).
- Pílula de conexão (`js/connection.js`): Conectando, Conectado · dado há N s, Dado antigo (em partida, > 120 s), Reconectando, Servidor indisponível, Sem rede. O SSE reconecta sozinho (`EventSource`); seu estado entra na dica da pílula.
- Preferências (`js/prefs.js`, chave `tft-compass-prefs`): tema, movimento, topo fixo, convite de instalação. `localStorage` com `try/catch` e cópia em memória.
- Carga: `modulepreload` dos módulos do caminho crítico, `<img>` com `width/height`, `loading="lazy"`, `decoding="async"`, mock só carregado com `?mock=`, tema aplicado antes da primeira pintura (sem piscar).

## 7.1 Contratos entre módulos

- `ui/shell.js` → `mountShell({ prefs, persistent, goTo, onMeta })` devolve `{ setView, setConnection, announce, toast, watchTop, openHelp, setAppInfo }`. É o único dono de tema, navegação ativa, pílula de conexão, anunciador `aria-live`, toasts, instalação do PWA e atalhos.
- Estados de erro das telas (Comps, Itens, Histórico) oferecem "Tentar de novo" disparando `document.dispatchEvent(new CustomEvent("tft:retry", { detail: { view } }))`; o `main.js` escuta e relê a tela.
- `focus.js` (`focusView(model)`) e `connection.js` (`connectionView(...)`) são puros e testados; `ui/focus-bar.js` e `ui/shell.js` só desenham o resultado.
- `ui/tooltip.js`: qualquer `title="…"` vira dica estilizada; informação essencial nunca fica só em `title`.
- Overlay (`overlay/hud/`): carrega `tokens.css` e `rich.css` e fixa `data-theme="dark"` no `<html>` (sobre o jogo é sempre escuro). Não depende de `base.css`/`components.css`; por isso `rich.css` mantém uma cópia de `.sr`.

## 7.2 Navegadores

Mínimo: Chromium 123 / Edge 123 / Firefox 120 / Safari 17.5 (`light-dark()`, `@container`, `:has()`, aninhamento, `<dialog>`, Popover). Abaixo disso a interface usa só o tema escuro em valores simples (`@supports not (color: light-dark(...))` em `tokens.css`). Instalação e modo offline exigem contexto seguro (localhost ou https); por IP na rede local (http) o app funciona, sem service worker.

## 8. Acessibilidade e desempenho (checklist)

- Landmarks: `banner` (barra), `nav`, `main`, `aside` (painel), seções com `aria-labelledby`; link "Ir para o conteúdo"; `<h1>` por tela (`#view-title`).
- Foco visível em tudo (`:focus-visible`), alvos de toque ≥ 40 px em `pointer: coarse`, contraste AA nos dois temas (cores de texto usam `--x`, fundos `--x-fill` + `--on-fill`), `prefers-contrast`, `forced-colors`.
- Imagens de campeão/item com nome acessível (`role="img"` + `aria-label`, ou `.sr` ao lado do texto rico).
- `aria-live`: um único anunciador educado (`#announcer`) para mudanças de decisão urgente e de conexão; os blocos de dados que atualizam a cada leitura não são regiões vivas.
- Movimento: `prefers-reduced-motion` e o ajuste "Reduzir" zeram animações e molas.
- Desempenho: reconciliação por chave e assinatura de HTML por linha (`data-sig`), texto só escrito se mudou, `container` em vez de media query onde o componente muda com o espaço, nada de layout shift (imagens com tamanho, retratos com `--s`).

## 9. Convenções para quem edita

1. Cor só por token. Texto = `--x`; fundo sólido = `--x-fill` + `--on-fill`; tinta = `color-mix(in oklab, var(--x), transparent N%)`.
2. Espaço e raio pela escala; tamanho de fonte por `--fs-*`.
3. Responsividade por `@container stage (...)` (ou `field`) quando o bloco depende do espaço; `@media` só para ponteiro, altura da janela e preferências.
4. Nomes de campeão/item só por `portrait`/`nameChip`/`richText` (o `names-guard` falha se alguém escrever `esc(x.name)` direto).
5. Nada de CSS morto: apague o seletor que nenhum JS/HTML usa.
6. Todo `<dialog>` usa `.dlg`; todo botão só de ícone tem `aria-label`.

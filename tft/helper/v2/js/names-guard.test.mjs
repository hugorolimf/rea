// Rodar com: node --test tft/helper/v2/js/
// Regra do produto: nenhum nome de campeão ou de item aparece só como texto na interface. Esta checagem varre os módulos
// de tela (v2/js/ui/*.js e main.js) e falha quando uma linha escreve um `.name`/`itemName(...)` no HTML sem passar pelos
// helpers de imagem (retrato, ícone, chip ou texto rico). É uma checagem de código, não de pixels: o que ela garante é
// que ninguém volta a imprimir `esc(champion.name)` direto numa tela nova. Lista de exceções abaixo, com o motivo.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("./ui/", import.meta.url));
/** Módulos do lado dos dados: leem o catálogo e fabricam as imagens; não desenham texto de tela. */
const HELPERS = ["glyphs.js", "rich-text.js"];
const files = [
  ...readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !HELPERS.includes(f))
    .map((f) => [`ui/${f}`, readFileSync(dir + f, "utf8")]),
  [
    "main.js",
    readFileSync(fileURLToPath(new URL("./main.js", import.meta.url)), "utf8"),
  ],
];

/** Chamadas que desenham a imagem do campeão/item (ou o chip com fallback em texto) na mesma linha. */
const IMAGE =
  /\b(portrait|itemPortrait|unitPortrait|unit|mini|tile|icon|nameChip|richText|champIcon)\(/;
/** Onde um nome aparece como dado: `esc(x.name)`, `x.name`, `itemName(...)`, `champions.get(id)?.name`. */
const NAME = /\.name\b|\bitemName\(|\bname\(|\.champion\b/;
/** Atributos que só guardam texto de dica ou rótulo de acessibilidade (não cabem imagens). */
const ATTR =
  /\b(title|aria-label)=("[^"]*"|`[^`]*`)|\.title\s*=|<title>|setAttribute\("(title|aria-label)"/g;

/**
 * Exceções: o `.name` ali NÃO é nome de campeão nem de item.
 * - `file` + `snippet` (trecho exato da linha) + `why`.
 */
const EXCEPTIONS = [
  { file: "ui/augs.js", snippet: "traitChip", why: "nome de sinergia" },
  {
    file: "ui/augs.js",
    snippet: "esc(name)}</span>`;",
    why: "nome de sinergia no chip do aprimoramento",
  },
  {
    file: "ui/augs.js",
    snippet: "a?.name ?? s.record.name",
    why: "nome de aprimoramento escolhido",
  },
  {
    file: "ui/augs.js",
    snippet: "<h3>${esc(c.name)}</h3>",
    why: "nome do aprimoramento oferecido",
  },
  {
    file: "ui/board.js",
    snippet: 'li.querySelector("span").textContent = t.name',
    why: "nome de sinergia",
  },
  {
    file: "ui/board.js",
    snippet: "key: (t) => t.name",
    why: "chave de sinergia",
  },
  {
    file: "ui/board.js",
    snippet: "s.exit.name} sai",
    why: "texto do <title> SVG da casa (dica de mouse e leitor de tela; a casa já é a imagem)",
  },
  {
    file: "ui/board.js",
    snippet: "`${c.name}${c.stars",
    why: "texto do <title> SVG da casa",
  },
  {
    file: "ui/board.js",
    snippet: "? `${t.name}: ${t.count} de",
    why: "dica da sinergia",
  },
  {
    file: "ui/board.js",
    snippet: ": `${t.name}: ${t.count}${via}`",
    why: "dica da sinergia",
  },
  {
    file: "ui/comps.js",
    snippet: "half: (r) =>",
    why: "texto que o desenho passa por richText (e usa como dica)",
  },
  {
    file: "ui/items.js",
    snippet: 'data-i="${esc((i?.name',
    why: "iniciais de fallback do ícone (o nome fica na dica e na legenda)",
  },
  {
    file: "ui/steps.js",
    snippet: "const label = `${p.name}: ${PART_STATE",
    why: "rótulo de acessibilidade e dica da peça da receita",
  },
  {
    file: "ui/subs.js",
    snippet: "name = (id) => champions.get(id)?.name ?? id",
    why: "consulta de nome; todo uso vem junto de unit() (retrato)",
  },
  {
    file: "ui/board.js",
    snippet: "const icon = traitIcon(t.name)",
    why: "ícone de sinergia",
  },
  {
    file: "ui/comps.js",
    snippet: "c.match.name",
    why: "nome de sinergia ativa na comp",
  },
  { file: "ui/contest.js", snippet: "top.name", why: "nome do jogador rival" },
  { file: "ui/contest.js", snippet: "r.name", why: "nome do jogador rival" },
  {
    file: "ui/contest.js",
    snippet: "[top.name, top.shared",
    why: "chave de redesenho com o nome do rival",
  },
  {
    file: "ui/history.js",
    snippet: "traitIcon(t.name)",
    why: "nome de sinergia",
  },
  {
    file: "ui/history.js",
    snippet: "esc(t.name)} ${t.count}",
    why: "nome de sinergia",
  },
  {
    file: "ui/history.js",
    snippet: "esc(a.name)",
    why: "nome de aprimoramento marcado na partida",
  },
  {
    file: "ui/items.js",
    snippet: "names = new Map(all.map",
    why: "índice de nomes para a busca por texto",
  },
  {
    file: "ui/items.js",
    snippet: "esc(i.nameEn",
    why: "nome em inglês no cabeçalho do detalhe, ao lado do ícone grande",
  },
  {
    file: "ui/items.js",
    snippet: "<h3>${esc(i.name)}</h3>",
    why: "título do detalhe do item, ao lado do ícone grande",
  },
  {
    file: "ui/items.js",
    snippet: "<span>${esc(i.name)}</span>",
    why: "legenda da linha da matriz de atributos, ao lado do ícone",
  },
  {
    file: "ui/panel.js",
    snippet: "curve.name",
    why: "rótulo de acessibilidade do gráfico",
  },
  {
    file: "ui/panel.js",
    snippet: "r.curve.name",
    why: "dica (tooltip) do gráfico",
  },
  {
    file: "main.js",
    snippet: "?.name;",
    why: "nome de aprimoramento oferecido",
  },
  { file: "main.js", snippet: "name,", why: "nome de aprimoramento guardado" },
  { file: "main.js", snippet: "a.name", why: "nome de aprimoramento" },
  { file: "main.js", snippet: "const name =", why: "nome de aprimoramento" },
  {
    file: "main.js",
    snippet: "augPicks.add(key, p.id, p.stage, p.name)",
    why: "nome de aprimoramento escolhido (copia as escolhas do GEP para o registro manual)",
  },
  {
    file: "ui/comps.js",
    snippet: "const name = a.item.name ?? itemName(a.item.id)",
    why: "nome só para a dica (title) e o alt do ícone: o item é desenhado por itemPortrait({ id, name }) na mesma função",
  },
  {
    file: "ui/comps.js",
    snippet: "const name = w.item.name ?? itemName(w.item.id)",
    why: "nome só para a dica (title) e o alt do ícone: o item é desenhado por itemPortrait({ id, name }) na mesma função",
  },
  {
    file: "ui/steps.js",
    snippet: 'title = u.name, attrs = ""',
    why: "valor padrão da dica (title) da peça; o campeão é o retrato (portrait) na mesma linha de saída e o nome fica em .sr",
  },
  {
    file: "ui/steps.js",
    snippet: "${r.unit.name}\\n${s.title}",
    why: "texto da dica (title) da peça na loja; o campeão é o retrato do tile",
  },
];

const attrFree = (line) => line.replace(ATTR, "");
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

function violations() {
  const out = [];
  for (const [file, text] of files)
    text.split("\n").forEach((line, i) => {
      if (isComment(line)) return;
      const code = attrFree(line);
      if (!NAME.test(code) || IMAGE.test(code)) return;
      if (EXCEPTIONS.some((e) => e.file === file && line.includes(e.snippet)))
        return;
      out.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  return out;
}

test("nenhuma tela escreve nome de campeão ou item sem imagem (exceções documentadas)", () => {
  assert.deepEqual(
    violations(),
    [],
    "use portrait/itemPortrait/nameChip/richText ou documente a exceção em EXCEPTIONS",
  );
});

test("a checagem pega o que deve pegar: nome direto no HTML sem helper de imagem", () => {
  const bad = [
    "`<b>${esc(champion.name)}</b>`",
    "`<li>${esc(itemName(id))}</li>`",
    "li.textContent = unit.name;",
  ];
  for (const line of bad)
    assert.ok(NAME.test(attrFree(line)) && !IMAGE.test(attrFree(line)), line);
  const fine = [
    "`${portrait(u.id, u.name)}<b>${esc(u.name)}</b>`",
    '`<span title="${esc(u.name)}">${itemPortrait(i)}</span>`',
    '`<li title="${esc(champ.name)}"></li>`',
    "`${richText(s.text)}`",
  ];
  for (const line of fine)
    assert.ok(
      !(NAME.test(attrFree(line)) && !IMAGE.test(attrFree(line))),
      line,
    );
});

test("as exceções apontam para linhas que ainda existem (sem exceção morta)", () => {
  const dead = EXCEPTIONS.filter(
    (e) => !files.some(([f, text]) => f === e.file && text.includes(e.snippet)),
  );
  assert.deepEqual(
    dead.map((e) => `${e.file}: ${e.snippet}`),
    [],
  );
});

test("o texto vindo do servidor passa pelo texto rico em cada tela que o escreve", () => {
  // Frases geradas pelo servidor (veredito, razões, passos, notas, títulos de comp) citam campeões e itens.
  const mustUse = {
    "ui/panel.js": [
      "richText(c.title)",
      "richText(c.reason)",
      "<li>${richText(t)}</li>",
    ],
    "ui/plan.js": [
      "richText(view.title)",
      "richText(view.challenger)",
      "richText(s.text)",
      "richText(c.text)",
      "richText(i.from",
      "richText(i.missing",
      'nameChip("champion", i.unitId, i.unit',
    ],
    "ui/augs.js": [
      "richText(r)",
      "richText(advice.note",
      "richText(advice.comp)",
      "richText(plain(c.desc))",
    ],
    "ui/comps.js": [
      "richText(c.title",
      "richText(goal.title)",
      "richText(auto)",
      "richText(text",
    ],
    "ui/contest.js": ["richText(alt.title)"],
    "ui/champ-items.js": ["richText(s.text"],
    "ui/hud.js": ['nameChip("champion", plan.carryId, plan.carry'],
  };
  const missing = [];
  for (const [file, needles] of Object.entries(mustUse)) {
    const text = files.find(([f]) => f === file)[1];
    for (const n of needles)
      if (!text.includes(n)) missing.push(`${file}: ${n}`);
  }
  assert.deepEqual(missing, []);
});

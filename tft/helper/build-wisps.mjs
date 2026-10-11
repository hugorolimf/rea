// Gera wisps.json: o catálogo dos Wisps (fogos-fátuos) do Set 18, a partir do CommunityDragon (mesma fonte de
// build-augments.mjs/catalog.json). O catálogo não separa Wisps dos demais itens por nome: o marcador é a etiqueta
// {5b609ae2} (hash de uma tag do jogo) junto do ícone de mecânica do Set 18 (`.../zaps/wands/set18_mechanicicon`).
// Entram só os DA_* com os dois; a etiqueta sozinha também marca os zaps do Xerath (Set 16) e um item oculto do Set 15.
// O que o catálogo NÃO traz — categoria, condição, preço — não é inventado: categoria e condição são deduzidas da
// descrição (core/catalog/wisps.mjs#classifyWisp) e marcadas como inferidas; preço e "custo 0" vêm só das notas de patch
// citadas em pesquisa/05 (WISP_FACTS) e, sem elas, ficam null.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyWisp,
  cleanWispText,
  wispFacts,
  wispType,
} from "./core/catalog/wisps.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)),
  source = "https://raw.communitydragon.org/latest/cdragon/tft/",
  WISP_TAG = "{5b609ae2}",
  WISP_ICON = /\/zaps\/wands\/set18_mechanicicon\./i;

const get = async (locale) => {
  const r = await fetch(source + locale + ".json", {
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw Error(locale + " HTTP " + r.status);
  return (await r.json()).items;
};
const [pt, en] = await Promise.all([get("pt_br"), get("en_us")]);
const portuguese = new Map(pt.map((i) => [i.apiName, i]));
// Texto do pt-BR que o catálogo ainda não traduziu vem como chave (TFT18_Charm_X_Name): não vale como nome.
const translated = (text) =>
  text && !/^TFT\d*_/i.test(String(text)) ? String(text) : null;

const iconKey = (icon) =>
  "wisp:" +
  String(icon)
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .toLowerCase();

const wisps = en
  .filter(
    (i) =>
      i.apiName.startsWith('DA_') &&
      (i.tags ?? []).includes(WISP_TAG) &&
      WISP_ICON.test(i.icon ?? "") &&
      i.name &&
      !/^@|^tft_item_name/i.test(i.name),
  )
  .map((i) => {
    const local = portuguese.get(i.apiName),
      // Versão melhorada (Blossom): "Upgrade"/"Prismatic" em qualquer ponto do apiName; a base é o mesmo id sem eles.
      melhorado = /Upgrade|Prismatic/.test(i.apiName),
      baseId = i.apiName.replace(/_?(Upgrade|Prismatic)/g, ""),
      facts = wispFacts(i.name, i.apiName),
      cls = classifyWisp(i),
      entry = {
        id: i.apiName,
        name: i.name,
        namePt: translated(local?.name),
        desc: cleanWispText(i.desc),
        descPt: translated(local?.desc) ? cleanWispText(local.desc) : null,
        icon: i.icon,
        iconKey: iconKey(i.icon),
        melhorado,
        baseId: melhorado ? baseId : null,
        // Wisp do slot vazio da loja ("Beggar's Wisp"): ouro de consolo, não uma compra.
        consolacao: i.apiName.startsWith('DA_BeggarsWisp18'),
        categoria: cls.categoria,
        categoriaFonte:
          "inferida da descricao (CommunityDragon nao traz categoria)",
        condicional: cls.condicional,
        condicaoTipo: cls.condicaoTipo,
        condicao: cls.condicao,
        exigePosicao: cls.exigePosicao,
        custoZero: facts.custoZero,
        // Preço único é da versão base; a melhorada (Blossom) pode custar outro valor e não é afirmada.
        custo: melhorado && !facts.custoZero ? null : facts.custo,
        custoNota: melhorado ? null : facts.custoNota,
        somePorVida: facts.somePorVida,
        naoClassificado: cls.naoClassificado,
      };
    return { ...entry, tipo: wispType(entry) };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const count = (list, key) =>
  list.reduce((acc, w) => {
    const k = String(w[key]);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
const base = wisps.filter((w) => !w.melhorado);
// Wisps citados na pesquisa que o catálogo (ainda) não tem: não são inventados aqui.
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const known = new Set(wisps.map((w) => norm(w.name)));
const missing = [
  "Room for a Shroom",
  "Major Gambit",
  "Gambit",
  "Smurfing",
  "Search Party",
].filter((n) => !known.has(norm(n)));

await fs.writeFile(
  path.join(root, "wisps.json"),
  JSON.stringify(
    {
      source: source + "en_us.json + pt_br.json",
      fetchedAt: new Date().toISOString(),
      selection:
        "apiName DA_* com a etiqueta " +
        WISP_TAG +
        " e o icone set18_mechanicicon",
      counts: {
        entradas: wisps.length,
        base: base.length,
        melhoradas: wisps.length - base.length,
        porTipo: count(wisps, "tipo"),
        porCategoria: count(wisps, "categoria"),
        condicionais: wisps.filter((w) => w.condicional).length,
        exigemPosicao: wisps.filter((w) => w.exigePosicao).length,
        comPrecoConhecido: wisps.filter((w) => w.custo).length,
        naoClassificados: wisps.filter((w) => w.naoClassificado).length,
      },
      naoClassificados: wisps.filter((w) => w.naoClassificado).map((w) => w.id),
      ausentesNoCatalogo: missing,
      notes: [
        "Categoria, condicao e exigePosicao sao deduzidas da descricao: pista, nao dado do jogo.",
        "custo so existe para os Wisps com preco unico (ou custo 0) nas notas de patch; null = o tooltip do jogo manda.",
        "As versoes melhoradas (_Upgrade, Blossom) sao entradas proprias com o mesmo nome; baseId aponta a base.",
      ],
      wisps,
    },
    null,
    1,
  ),
);
console.log(
  JSON.stringify({
    entradas: wisps.length,
    base: base.length,
    porTipo: count(wisps, "tipo"),
    porCategoria: count(wisps, "categoria"),
    condicionais: wisps.filter((w) => w.condicional).length,
    naoClassificados: wisps.filter((w) => w.naoClassificado).length,
    ausentes: missing,
  }),
);

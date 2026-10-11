import fs from "node:fs/promises";
import path from "node:path";

/** Tipos web servidos como estáticos (o resto vira 404). */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  // PWA (v2/manifest.webmanifest, v2/icons/*.png).
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

/**
 * Arquivos servidos num endereço fixo da raiz: o service worker precisa estar em `/sw.js` para controlar o escopo `/`
 * (a página principal), e o manifesto fica ao lado dele. Os dois vivem em `v2/`.
 */
const ROOT_FILES = {
  "/sw.js": "v2/sw.js",
  "/manifest.webmanifest": "v2/manifest.webmanifest",
};

/**
 * Prefixo da URL -> pasta do helper: a interface, o núcleo puro (os mesmos módulos que o servidor importa) e a página
 * do HUD do overlay (só `overlay/hud`: o resto de `overlay/`, como `node_modules`, fica fora do alcance).
 */
const DIRS = { "/v2/": "v2", "/core/": "core", "/overlay/": "overlay/hud" };

/**
 * Resolve o caminho de uma URL estática (`/`, `/v2/*`, `/core/*`, `/overlay/*`, `/sw.js`, `/manifest.webmanifest`) para um arquivo dentro da pasta certa. Devolve null
 * quando a URL não é estática; `{ target, type }` caso contrário, com `type` undefined se o arquivo não pode ser
 * servido (tipo não web ou fora da pasta: sem sair do diretório).
 */
export function staticTarget(root, pathname) {
  const fixed = Object.hasOwn(ROOT_FILES, pathname)
    ? path.resolve(root, ROOT_FILES[pathname])
    : null;
  if (fixed) return { target: fixed, type: TYPES[path.extname(fixed)] };
  const prefix =
    pathname === "/"
      ? "/v2/"
      : Object.keys(DIRS).find((p) => pathname.startsWith(p));
  if (!prefix) return null;
  const base = path.resolve(root, DIRS[prefix]),
    target = path.resolve(
      base,
      pathname === "/" ? "index.html" : pathname.slice(prefix.length),
    ),
    type = TYPES[path.extname(target)];
  return {
    target,
    type: target.startsWith(base + path.sep) ? type : undefined,
  };
}

/**
 * Responde `pathname` se for estático (`/`, `/v2/*`, `/core/*`, `/overlay/*`) e devolve true; false se a rota é de outro dono.
 * O arquivo é lido ANTES de qualquer cabeçalho: arquivo ausente (ou ilegível) responde 404 limpo em JSON, sem
 * `writeHead(200)` já enviado (antes, o `catch` tentava escrever o cabeçalho de novo e a resposta virava erro 400/queda).
 * `json(status, corpo)` é o escritor de JSON do servidor.
 */
export async function sendStatic(res, root, pathname, json) {
  const asset = staticTarget(root, pathname);
  if (!asset) return false;
  if (!asset.type) {
    json(404, { error: "Rota não encontrada." });
    return true;
  }
  let body;
  try {
    body = await fs.readFile(asset.target);
  } catch {
    json(404, { error: "Arquivo não encontrado." });
    return true;
  }
  res.writeHead(200, {
    "Content-Type": asset.type,
    "Cache-Control": "no-cache",
  });
  res.end(body);
  return true;
}

import path from "node:path";

/** Tipos web servidos como estáticos (o resto vira 404). */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

/** Prefixo da URL -> pasta do helper: a interface e o núcleo puro (os mesmos módulos que o servidor importa). */
const DIRS = { "/v2/": "v2", "/core/": "core" };

/**
 * Resolve o caminho de uma URL estática (`/`, `/v2/*`, `/core/*`) para um arquivo dentro da pasta certa. Devolve null
 * quando a URL não é estática; `{ target, type }` caso contrário, com `type` undefined se o arquivo não pode ser
 * servido (tipo não web ou fora da pasta: sem sair do diretório).
 */
export function staticTarget(root, pathname) {
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

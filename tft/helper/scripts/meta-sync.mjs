// Sincroniza a extensão MetaTFT offline (meta-store.mjs) e imprime UMA linha de resumo. Chamado pelo start-all.ps1
// antes de subir o servidor. Nunca bloqueia nem falha o início: tem teto de tempo (padrão 12 s, máximo 15 s), e sem
// rede segue com a cópia local ou com o snapshot do repositório. Código de saída sempre 0.
// Uso: node scripts/meta-sync.mjs [--timeout=12000] [--force] [--only=comps,builds,stats,augments] [--dir=PASTA] [--embed]
// `--embed` (manutenção, nunca no atalho): o que foi baixado e validado nesta execução também vira o snapshot embarcado
// do repositório (`meta-*.json`), a cópia que vale numa instalação nova ou sem rede.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATASET_NAMES,
  createMetaStore,
  defaultMetaDir,
} from "../meta-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const MAX_MS = 15_000;
const timeoutMs = Math.min(
  MAX_MS,
  Math.max(1_000, Number(arg("timeout")) || 12_000),
);
const only = arg("only")
  ?.split(",")
  .filter((n) => DATASET_NAMES.includes(n));
const store = createMetaStore({
  root,
  dir: arg("dir") ?? defaultMetaDir(root),
  set: "TFTSet18",
});

// Última defesa: se algo travar além do teto (disco, DNS), imprime e sai mesmo assim.
const guard = setTimeout(() => {
  console.log("meta não sincronizada a tempo: segue com a cópia local");
  process.exit(0);
}, timeoutMs + 3_000);

try {
  const { line, results } = await store.sync({
    names: only?.length ? only : DATASET_NAMES,
    timeoutMs,
    force: process.argv.includes("--force"),
  });
  const embedded = [];
  if (process.argv.includes("--embed"))
    for (const [name, r] of Object.entries(results))
      if (r.status === "atualizada" && (await store.embed(name)))
        embedded.push(name);
  console.log(
    embedded.length
      ? `${line}; snapshot do repositório regravado: ${embedded.join(", ")}`
      : line,
  );
} catch (e) {
  console.log(
    `meta não sincronizada (${e?.message ?? e}): segue com a cópia local`,
  );
}
clearTimeout(guard);
process.exit(0);

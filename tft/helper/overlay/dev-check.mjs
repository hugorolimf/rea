// Verificação usada pelo recarregamento automático antes de reiniciar o Electron (ver dev-reload.mjs). O processo
// principal a roda como filho, com ELECTRON_RUN_AS_NODE=1:
//   electron.exe dev-check.mjs <main.mjs> <outros módulos do grafo...>
// Sai com 0 se o código novo do processo principal carrega; com 1 e a lista de problemas no stderr, se não.
// Não abre janela, não fala com o jogo nem com o servidor.
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { checkMainGraph } from "./dev-reload.mjs";

const [entry, ...files] = process.argv.slice(2);
const problems = await checkMainGraph(entry, files, {
  spawnSync,
  execPath: process.execPath,
  vm,
});
if (problems.length) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exitCode = 1;
}

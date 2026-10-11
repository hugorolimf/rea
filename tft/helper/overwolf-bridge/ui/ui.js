"use strict";
const el = document.getElementById("state");
const row = (k, v, cls) => {
  const dt = document.createElement("dt"),
    dd = document.createElement("dd");
  dt.textContent = k;
  dd.textContent = v ?? "-";
  if (cls) dd.className = cls;
  el.append(dt, dd);
};
const when = (t) =>
  t ? new Date(t).toLocaleTimeString("pt-BR") : "nenhum ainda";

async function refresh() {
  let s;
  try {
    s = await window.bridge.status();
  } catch {
    return;
  }
  el.replaceChildren();
  row(
    "Overwolf",
    s.underOwElectron ? "ow-electron ativo" : "não está rodando no ow-electron",
    s.underOwElectron ? "ok" : "bad",
  );
  row("Pacote GEP", s.gepPackage, s.gepPackage === "pronto" ? "ok" : "warn");
  if (s.gepDetail) row("Detalhe", s.gepDetail, "warn");
  row("Jogo", s.game, s.game === "nenhum" ? "" : "ok");
  row(
    "Eventos do jogo",
    s.featuresSet
      ? "pedidos ao Overwolf"
      : (s.featuresError ?? "ainda não pedidos"),
    s.featuresSet ? "ok" : "",
  );
  if (s.recorder) {
    row("Eventos gravados", String(s.recorder.persisted));
    row("Descartados (filtro)", String(s.recorder.dropped));
    row("Último evento", when(s.recorder.lastEventAt));
    row("Partidas", String(s.recorder.games));
  } else row("Gravador", "indisponível", "bad");
  row("Arquivo", s.db);
  row("Status local", `http://127.0.0.1:${s.statusPort}/status`);
}
refresh();
setInterval(refresh, 2000);

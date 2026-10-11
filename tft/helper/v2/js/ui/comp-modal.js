import { esc } from "../dom.js";
import { scoreOf } from "../comps.js";
import {
  choiceState,
  keepIndex,
  navKey,
  positionLabel,
  stepIndex,
  suggestionIds,
} from "../suggest.js";
import { compOwnership } from "../roster.js";
import { compCard, compsContext, stateItem } from "./comps.js";
import { glyph, portrait } from "./glyphs.js";
import { richText } from "./rich-text.js";

/**
 * Modal da célula "Meta" do HUD: mostra a comp que o Ao vivo sugere (o mesmo cartão da aba Comps) e as outras sugestões
 * do motor, e deixa escolher (fixar) ou desfazer a escolha. Usa <dialog> com showModal(): o navegador cuida do foco
 * preso no diálogo, do restante da página inerte e do Esc; o resto (foco inicial, retorno do foco, clique fora, setas)
 * está aqui. A escolha é a mesma da aba Comps (`onPick(id)` / `onRelease()` são os mesmos do main.js).
 *
 * `update(data)` recebe os dados do cartão (ver `compsContext`) mais `planId` (comp que o Ao vivo mostra) e `goalId`
 * (comp fixada); pode ser chamado a cada leitura, e só redesenha quando algo visível mudou.
 * `open(trigger)` abre e devolve o foco a `trigger` ao fechar.
 */
export function mountCompModal({ onPick, onRelease }) {
  const dlg = document.createElement("dialog");
  // Base `.dlg` de components.css (fundo, borda, sombra, entrada animada, folha embaixo em tela estreita).
  dlg.className = "dlg comp-modal";
  dlg.setAttribute("aria-labelledby", "cm-title");
  dlg.setAttribute("aria-describedby", "cm-status");
  dlg.setAttribute("aria-modal", "true");
  dlg.innerHTML = `<div class="dlg-box cm-box">
    <header class="dlg-head cm-head">
      <div class="cm-pager" role="group" aria-label="Navegar pelas sugestões">
        <button type="button" class="btn btn-icon cm-step" data-step="-1" aria-label="Sugestão anterior">${glyph("prev")}</button>
        <output class="cm-pos" id="cm-pos" aria-hidden="true"></output>
        <button type="button" class="btn btn-icon cm-step" data-step="1" aria-label="Próxima sugestão">${glyph("next")}</button>
      </div>
      <h2 id="cm-title" tabindex="-1"></h2>
      <button type="button" class="btn btn-icon cm-close" data-close aria-label="Fechar">${glyph("x")}</button>
    </header>
    <ul class="tabs cm-tabs" id="cm-tabs" aria-label="Sugestões"></ul>
    <div class="dlg-body cm-body" id="cm-body" tabindex="0" role="region" aria-label="Detalhes da comp"><ol class="cm-card" id="cm-card"></ol></div>
    <footer class="dlg-foot cm-foot">
      <p class="cm-state" id="cm-status" role="status"></p>
      <a class="link cm-all" href="#comps" data-all>Ver todas as comps</a>
      <button type="button" class="btn btn-solid cm-act" id="cm-act"></button>
    </footer>
    <p class="sr" id="cm-announce" role="status" aria-live="polite"></p>
  </div>`;
  document.body.append(dlg);
  const $ = (id) => dlg.querySelector(`#${id}`),
    native = typeof dlg.showModal === "function",
    openIds = new Set();
  let data = null,
    ids = [],
    currentId = null,
    trigger = null,
    drawn = "",
    pressedOutside = false,
    announced = "";

  /** Foco que sobrevive ao redesenho: guarda um seletor do elemento ativo e o restabelece depois. */
  function focusKeeper() {
    const a = document.activeElement;
    if (!a || !dlg.contains(a)) return () => {};
    const sel = a.matches(".cm-tab")
      ? `.cm-tab[data-id="${CSS.escape(a.dataset.id)}"]`
      : a.matches("summary") && a.parentElement?.dataset.more
        ? `details[data-more="${CSS.escape(a.parentElement.dataset.more)}"] > summary`
        : null;
    return () => sel && dlg.querySelector(sel)?.focus();
  }

  const plainScore = (c) => scoreOf(c)?.score ?? null;

  function draw() {
    if (!data || !data.comps) return;
    const ctx = compsContext(data),
      byId = new Map(ctx.all.map((c) => [c.id, c])),
      { ids: next, start } = suggestionIds({
        ranking: data.ranking,
        knownIds: new Set(byId.keys()),
        planId: data.planId,
        goalId: data.goalId,
      });
    ids = next;
    const index = keepIndex(ids, currentId, start);
    currentId = ids[index] ?? null;
    const c = byId.get(currentId) ?? null,
      st = choiceState({
        id: currentId,
        goalId: data.goalId,
        planId: data.planId,
        ranking: data.ranking,
      });
    const key = JSON.stringify([
      ids,
      currentId,
      ids.map((id) => byId.get(id)?.fit),
      data.goalId,
      data.planId,
      data.swapCount,
      data.roster,
      data.bank,
      data.equipped,
      data.lobby,
    ]);
    if (key === drawn) return;
    drawn = key;
    const restore = focusKeeper(),
      body = $("cm-body"),
      top = body.scrollTop;

    $("cm-title").textContent = !c
      ? "Sem comp sugerida"
      : st.chosen
        ? "Comp escolhida"
        : st.kept
          ? "Plano atual (mantido)"
          : st.live
            ? "Comp sugerida agora"
            : st.best
              ? "Melhor sugestão"
              : "Outra sugestão";
    $("cm-pos").textContent = positionLabel(index, ids.length);
    for (const b of dlg.querySelectorAll(".cm-step"))
      b.disabled = ids.length < 2;

    $("cm-tabs").innerHTML = ids
      .map((id, i) => {
        const x = byId.get(id),
          s = choiceState({
            id,
            goalId: data.goalId,
            planId: data.planId,
            ranking: data.ranking,
          }),
          score = plainScore(x),
          exp = Number.isFinite(x.fit?.expected)
            ? `${String(Math.round(x.fit.expected * 10) / 10).replace(".", ",")}º esperado${Number.isFinite(x.fit?.top4) ? ` · ${Math.round(x.fit.top4)}% top 4` : ""}`
            : null,
          // Suas peças desta comp em campo e na reserva: a mesma regra do cartão (roster.js).
          own = compOwnership(data.roster ?? null, x.units).text,
          label = `${x.title}${exp ? `, ${exp}` : ""}${score != null ? `, score ${score}` : ""}, ${own}${s.chosen ? ", escolhida" : s.kept ? ", plano atual (mantido)" : s.live ? ", sugerida agora" : ""}${s.best && !s.live ? ", melhor sugestão" : ""}`;
        return `<li><button type="button" class="cm-tab" data-id="${esc(id)}" data-i="${i}"${id === currentId ? ' aria-current="true"' : ""}${s.chosen ? ' data-chosen=""' : ""}${s.best ? ' data-best=""' : ""} aria-label="${esc(label)}" title="${esc(label)}">${portrait(x.carry, x.title, { size: 26, hidden: true })}<span class="cm-tab-score">${score ?? "—"}</span>${s.chosen ? glyph("flag") : s.best && !s.live ? glyph("crown") : ""}</button></li>`;
      })
      .join("");

    $("cm-card").innerHTML = c
      ? compCard(c, {
          goalId: data.goalId,
          open: openIds.has(c.id),
          openWish: openIds.has(`${c.id}:wish`),
          items: ctx.items,
          actions: false,
          synergies: true,
        })
      : stateItem({
          icon: "inbox",
          title: "Sem sugestões nesta leitura",
          body: "<p>Use “Ver todas as comps”, logo abaixo, para escolher uma.</p>",
        });
    body.scrollTop = top;
    // Mantém a aba atual à vista quando a fila de abas passa da largura do diálogo.
    $("cm-tabs")
      .querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });

    const act = $("cm-act");
    act.hidden = !c;
    act.dataset.mode = st.chosen ? "release" : "pick";
    act.textContent = st.chosen ? "Desfazer escolha" : "Escolher esta comp";
    // Ação principal só ao escolher; desfazer é um botão comum.
    act.classList.toggle("btn-solid", !st.chosen);
    $("cm-status").innerHTML = !c
      ? ""
      : st.chosen
        ? `${glyph("check")}<span><b>Escolhida.</b> O Ao vivo, as trocas e a economia seguem <b>${richText(c.title)}</b>${data.swapCount ? ` com ${data.swapCount} substituição(ões)` : ""} ${data.lobby ? "até você desfazer ou a próxima partida começar (a escolha do lobby não passa para a partida)" : "até você desfazer ou a partida acabar"}.</span>`
        : data.goalId
          ? `<span>Você segue outra comp. Escolher esta troca a escolha atual.</span>`
          : st.live
            ? `<span>É a sugestão que o Ao vivo segue agora; ela pode mudar a cada leitura. Escolher fixa esta comp.</span>`
            : `<span>Outra sugestão do motor. Escolher fixa esta comp no Ao vivo.</span>`;
    restore();

    // Anúncio para leitor de tela só quando a comp ou a escolha mudam (não a cada leitura).
    const say = c
      ? `${positionLabel(index, ids.length)}: ${c.title}${st.chosen ? ", escolhida" : ""}`
      : "";
    if (say !== announced) {
      announced = say;
      $("cm-announce").textContent = say;
    }
  }

  const go = (delta) => {
    if (ids.length < 2) return;
    currentId = ids[stepIndex(ids.indexOf(currentId), delta, ids.length)];
    drawn = "";
    draw();
    $("cm-body").scrollTop = 0;
  };

  function close() {
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener("click", (e) => {
    // Clique no fundo (o próprio <dialog>, sem preenchimento): fecha, se o botão também foi apertado lá.
    if (e.target === dlg) {
      if (pressedOutside) close();
      return;
    }
    const t = e.target;
    if (t.closest("[data-close]")) return close();
    const step = t.closest("[data-step]");
    if (step) return go(Number(step.dataset.step));
    const tab = t.closest(".cm-tab");
    if (tab) {
      currentId = tab.dataset.id;
      drawn = "";
      draw();
      $("cm-body").scrollTop = 0;
      return;
    }
    if (t.closest("[data-all]")) {
      // Segue o link para a aba Comps; o foco não volta ao HUD (a visão muda).
      trigger = null;
      return close();
    }
    if (t.closest("#cm-act")) {
      if ($("cm-act").dataset.mode === "release") onRelease();
      else if (currentId) onPick(currentId);
    }
  });
  dlg.addEventListener("pointerdown", (e) => {
    pressedOutside = e.target === dlg;
  });
  dlg.addEventListener(
    "toggle",
    (e) => {
      const id = e.target.dataset?.more;
      if (id) e.target.open ? openIds.add(id) : openIds.delete(id);
    },
    true,
  );
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // O main.js também escuta o Esc (fecha os itens do campeão): aqui ele é só do modal.
      e.stopPropagation();
      if (!native) close();
      return;
    }
    const delta = navKey(e.key);
    if (
      delta == null ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.target.closest?.("input, select, textarea")
    )
      return;
    e.preventDefault();
    go(delta);
  });
  // Esc nativo: o fechamento passa por `close()` para o retorno do foco ser um só.
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener("close", () => {
    const back = trigger;
    trigger = null;
    drawn = "";
    if (back?.isConnected && !back.hidden) back.focus();
  });

  return {
    /** Atualiza os dados (a cada leitura); redesenha só se o modal está aberto e algo visível mudou. */
    update(next) {
      data = next;
      if (dlg.open) draw();
    },
    /** Abre na comp que o Ao vivo mostra; o foco inicial vai para o botão de escolher. */
    open(from = document.activeElement) {
      if (dlg.open || !data) return;
      trigger = from;
      currentId = null;
      drawn = "";
      announced = "";
      if (native) dlg.showModal();
      else dlg.setAttribute("open", "");
      draw();
      const act = $("cm-act");
      (act.hidden ? $("cm-title") : act).focus();
    },
    close,
    get isOpen() {
      return dlg.open;
    },
  };
}

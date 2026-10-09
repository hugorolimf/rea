/* Mock da tela "Ao vivo". Só age com ?mock=<cenário>; sem o parâmetro não faz nada.
 * Intercepta /api/state e /api/recommend com dados congelados (live-mock-base.json) alterados por
 * cenário. Catálogo, ícones e o restante da interface continuam os reais. Abra /live-mock.html
 * para ver todos os cenários lado a lado. */
(() => {
  const HERO = "47445859";
  const qs = new URLSearchParams(location.search);
  const params = { open: qs.get("open") === "1" };
  const clone = (v) => structuredClone(v);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Dados de fixture (ids reais do catálogo para os ícones aparecerem) ----
  const ch = (id, name) => ({ id, name });
  const APH = ch("DA_18_Aphelios", "Aphelios"),
    NID = ch("DA_Nidalee18_AP", "Nidalee"),
    VI = ch("DA_Vi18", "Vi"),
    DIA = ch("DA_18_Diana", "Diana"),
    VAR = ch("DA_18_Varus", "Varus"),
    AMU = ch("DA_Amumu18", "Amumu"),
    SEN = ch("DA_Sentinel18", "Sentinel"),
    BRA = ch("DA_Brambleback18", "Brambleback"),
    MAMA = ch("DA_CrimsonRaptor18", "Mama Beak"),
    RAK = ch("DA_18_Rakan", "Rakan"),
    XAY = ch("DA_18_Xayah", "Xayah");
  const it = (id, name) => ({ id, name });
  const IE = it("DA_InfinityEdge", "Infinity Edge"),
    LW = it("DA_LastWhisper", "Last Whisper"),
    SOS = it("DA_SpearOfShojin", "Spear of Shojin"),
    SV = it("DA_SpiritVisage", "Spirit Visage"),
    SUN = it("DA_SunfireCape", "Sunfire Cape"),
    DB = it("DA_Deathblade", "Deathblade");

  const stageBoard = () => [
    {
      ...AMU,
      cost: 4,
      status: "meta",
      owned: true,
      stars: 2,
      items: 3,
      equipNow: [],
      nextItem: null,
      slotsFree: 0,
    },
    {
      ...SEN,
      cost: 2,
      status: "meta",
      owned: true,
      stars: 1,
      items: 0,
      equipNow: [SV],
      nextItem: {
        ...it("DA_Evenshroud", "Evenshroud"),
        missing: ["Chain Vest", "Negatron Cloak"],
      },
      slotsFree: 3,
    },
    {
      ...DIA,
      cost: 3,
      status: "meta",
      owned: true,
      stars: 2,
      items: 0,
      equipNow: [],
      nextItem: { ...SUN, missing: ["Chain Vest", "Giant's Belt"] },
      slotsFree: 3,
    },
    {
      ...VAR,
      cost: 1,
      status: "meta",
      owned: true,
      stars: 2,
      items: 0,
      equipNow: [LW, SOS],
      nextItem: { ...it("DA_Bloodthirster", "Bloodthirster"), missing: [] },
      slotsFree: 3,
    },
    {
      ...APH,
      cost: 4,
      status: "meta",
      owned: false,
      stars: 0,
      items: 0,
      equipNow: [IE],
      nextItem: null,
      slotsFree: 3,
    },
    {
      ...NID,
      cost: 1,
      status: "temporario",
      owned: true,
      stars: 2,
      items: 3,
      equipNow: [],
      nextItem: null,
      slotsFree: 0,
    },
    {
      ...VI,
      cost: 3,
      status: "temporario",
      owned: true,
      stars: 2,
      items: 1,
      equipNow: [],
      nextItem: null,
      slotsFree: 2,
    },
  ];
  const transitions = () => [
    {
      enter: APH,
      exit: {
        ...NID,
        items: ["DA_SteraksGage", "DA_InfinityEdge", "DA_EdgeOfNight"],
      },
      source: "shop",
      reason: "Aphelios 2★ pronto: Nidalee 2★ perde espaço.",
      exitStars: 2,
      exitPower: 9,
      enterCopies: 3,
      enterStars: 2,
      requiredStars: 2,
      ready: true,
    },
    {
      enter: MAMA,
      exit: { ...VI, items: [] },
      source: "shop",
      reason: "Mama Beak entrega a frontline que Vi não completa.",
      exitStars: 2,
      exitPower: 6,
      enterCopies: 3,
      enterStars: 2,
      requiredStars: 2,
      ready: true,
    },
    {
      enter: RAK,
      exit: { ...DIA, items: ["DA_SunfireCape"] },
      source: "shop",
      reason: "Rakan não alcança Diana 2★ nem em 3★.",
      exitStars: 2,
      exitPower: 8,
      enterCopies: 1,
      enterStars: 1,
      requiredStars: 2,
      ready: false,
    },
    {
      enter: XAY,
      exit: null,
      source: "reserve",
      reason: "Já está na reserva.",
      enterCopies: 2,
      enterStars: 1,
    },
    {
      enter: BRA,
      exit: null,
      source: "shop",
      reason: "Ocupa a vaga ao subir de nível.",
      enterCopies: 0,
      enterStars: 0,
    },
  ];
  const itemMoves = () => [
    {
      from: { ...NID, stars: 2 },
      leaving: true,
      moves: [
        { item: { ...IE, components: [] }, to: APH, rank: 1, toCarry: true },
        {
          item: { ...it("DA_EdgeOfNight", "Edge of Night"), components: [] },
          to: VAR,
          rank: 3,
          toCarry: false,
        },
      ],
      priority: 4,
      now: true,
      method: "removedor lido na tela",
    },
    {
      from: { ...VI, stars: 2 },
      leaving: true,
      moves: [
        { item: { ...SUN, components: [] }, to: DIA, rank: 2, toCarry: false },
      ],
      priority: 2,
      now: false,
      method: "removedor (banco não lido)",
    },
  ];
  const carousel = () => [
    {
      id: "DA_Component_SparringGloves",
      name: "Sparring Gloves",
      score: 27.9,
      owned: 0,
      uses: [
        {
          champion: "Aphelios",
          item: "Infinity Edge",
          itemId: "DA_InfinityEdge",
          completesNow: false,
          reason: "Começa Infinity Edge; falta também B.F. Sword.",
        },
      ],
      rank: 1,
    },
    {
      id: "DA_Component_BFSword",
      name: "B.F. Sword",
      score: 27.8,
      owned: 1,
      uses: [
        {
          champion: "Varus",
          item: "Spear of Shojin",
          itemId: "DA_SpearOfShojin",
          completesNow: false,
          reason: "Começa Spear of Shojin.",
        },
      ],
      rank: 2,
    },
    {
      id: "DA_Component_ChainVest",
      name: "Chain Vest",
      score: 21.4,
      owned: 0,
      uses: [
        {
          champion: "Amumu",
          item: "Bramble Vest",
          itemId: "DA_BrambleVest",
          completesNow: false,
          reason: "Fecha a frontline.",
        },
      ],
      rank: 3,
    },
  ];
  const bankItems = () => [
    { ...DB, to: VAR, reason: "1º item de Varus na meta" },
    {
      ...it("DA_GiantSlayer", "Giant Slayer"),
      to: DIA,
      reason: "papel compatível com Diana (temporário; passe adiante depois)",
    },
    {
      ...it("DA_Redemption", "Redemption"),
      to: null,
      reason:
        "nenhuma unidade em campo com slot livre usa bem este item; guarde",
    },
  ];
  const buyNow = () => [
    {
      ...APH,
      cost: 4,
      chancePerShop: 0.1218,
      remaining: 10,
      affordable: true,
      isCarry: true,
      replaces: "Nidalee",
      slot: "troca",
      inShop: true,
    },
    {
      ...BRA,
      cost: 4,
      chancePerShop: 0.1218,
      remaining: 10,
      affordable: true,
      isCarry: false,
      replaces: null,
      slot: "vaga",
      inShop: false,
    },
    {
      ...XAY,
      cost: 1,
      chancePerShop: 0.0533,
      remaining: 30,
      affordable: true,
      isCarry: false,
      replaces: null,
      slot: "banco",
      inShop: false,
    },
    {
      ...MAMA,
      cost: 3,
      chancePerShop: 0.0094,
      remaining: 18,
      affordable: false,
      isCarry: false,
      replaces: "Vi",
      slot: "troca",
      inShop: false,
    },
  ];
  const shopCards = () => [
    {
      slot: 1,
      ...APH,
      cost: 4,
      action: "comprar",
      reason: "carry da meta · fecha um 2★",
    },
    {
      slot: 2,
      ...XAY,
      cost: 1,
      action: "segurar",
      reason: "peça da meta · compraria abaixo de 50g de juros",
    },
    { slot: 3, ...MAMA, cost: 3, action: "sem ouro", reason: "peça da meta" },
    {
      slot: 4,
      ...RAK,
      cost: 1,
      action: "ignorar",
      reason: "fora do plano atual",
    },
    {
      slot: 5,
      ...VAR,
      cost: 1,
      action: "comprar",
      reason: "peça da meta · cópia de unidade sua",
    },
  ];

  // ---- Estratégia (mesmo formato de strategy.mjs) ----
  const interestOf = (g) => Math.min(5, Math.floor(g / 10));
  function strategyFor(action, o) {
    const gold = o.gold,
      shops = action === "ROLAR" ? Math.floor(o.spend / 2) : 0,
      next =
        gold == null || gold >= 50 ? null : (Math.floor(gold / 10) + 1) * 10;
    const target = (id, name, cost, own, goal, enemy) => ({
      id,
      name,
      cost,
      goalStars: 2,
      own,
      goal,
      left: 12 - own,
      enemy,
      chancePerShop: 0.1218,
      chanceInRoll: shops ? 1 - (1 - 0.1218) ** shops : null,
      done: own >= goal,
    });
    const lvl = action === "SUBIR NÍVEL";
    const text = {
      ECONOMIZAR: {
        head: `Economize até ${next ?? 50}g e suba no tempo certo`,
        steps: [
          "Economize: o carry Aphelios (custo 4) só aparece bem a partir do nível 8. Não role agora.",
          "Ajuste itens e posições com o ouro parado.",
        ],
      },
      ROLAR: {
        head: `Role ${o.spend}g por Aphelios 2★`,
        steps: [
          `Role ${o.spend}g (${shops} lojas) no nível ${o.level} buscando Aphelios 2★ e a frontline 2★; pare em ${o.keep}g.`,
        ],
      },
      "SUBIR NÍVEL": {
        head: `Suba para o nível ${o.level + 1}`,
        steps: [
          `Núcleo pronto: suba para o nível ${o.level + 1} (4g) para encaixar mais uma unidade forte.`,
        ],
      },
    }[action] ?? { head: "Partida encerrada para o Hero", steps: [] };
    return {
      action,
      headline: text.head,
      steps: text.steps,
      reasons: [
        "Aphelios: 1/3 cópias para 2★, 9 livres na pool, 2 com rivais.",
        "Você é o 3º de 8 em força: o lobby ainda permite economizar.",
      ],
      ev: null,
      lobby: null,
      style: "Fast 8",
      rerollLevel: null,
      finalLevel: 9,
      levelCost: lvl ? 4 : 28,
      interestAt: 50,
      panels: {
        economy: {
          gold,
          interest: gold == null ? 0 : interestOf(gold),
          next,
          keep: o.keep ?? null,
          value: gold == null ? "–" : gold + "g",
          verdict:
            action === "ECONOMIZAR"
              ? "ECONOMIZAR AGORA"
              : o.keep != null
                ? "piso desta decisão: " + o.keep + "g"
                : "",
          text:
            gold == null
              ? "Ouro não lido da tela."
              : `Juros atuais: +${interestOf(gold)}g por rodada.` +
                (next
                  ? ` Próximo patamar em ${next}g (faltam ${next - gold}g).`
                  : " Juros no máximo (50g)."),
        },
        leveling: {
          level: o.level,
          xp:
            typeof o.xp === "string" && o.xp.includes("/")
              ? {
                  have: Number(o.xp.split("/")[0]),
                  total: Number(o.xp.split("/")[1]),
                }
              : null,
          cost: lvl ? 4 : 28,
          go: lvl,
          curve: o.level,
          finalLevel: o.final ?? 9,
          value: "Nível " + o.level,
          verdict: lvl ? "SUBIR AGORA · 4g" : "não subir agora",
          text:
            "Faltam 12 XP (28g) para o nível " +
            (o.level + 1) +
            ". Curva padrão no estágio 4-2: nível 8. Nível final desta comp: 9.",
        },
        rolling: {
          level: o.level,
          at: o.rollAt ?? 8,
          go: action === "ROLAR",
          spend: action === "ROLAR" ? o.spend : 0,
          shops,
          keep: o.keep ?? null,
          value: "Nível de roll 8",
          verdict:
            action === "ROLAR"
              ? `ROLAR ${o.spend}g · ${shops} lojas · parar em ${o.keep}g`
              : "não rolar agora",
          text: "Este é o nível de rolagem da comp.",
          targets: [
            target(APH.id, "Aphelios", 4, 1, 3, 2),
            target(VAR.id, "Varus", 1, 3, 3, 0),
          ],
        },
      },
    };
  }

  // ---- Montagem de um estado ao vivo completo ----
  const patchMeta = (c, patch) => {
    Object.assign(c.state, patch);
    Object.assign(c.rec.metadata, patch);
  };
  const setPlayers = (c, hp) => {
    const alive = [77, 63, 48, 31, 22, 9, 0];
    let i = 0;
    for (const p of c.state.players) p.health = p.id === HERO ? hp : alive[i++];
    c.rec.metadata.players = clone(c.state.players);
    c.rec.self.health = hp;
  };
  function live(c, o = {}) {
    const x = {
      hp: 58,
      gold: 54,
      level: 8,
      xp: "23/68",
      stage: "4-2",
      action: "ECONOMIZAR",
      spend: 30,
      keep: 24,
      screen: true,
      ...o,
    };
    patchMeta(c, {
      actionable: true,
      phase: "Planejamento",
      ageSeconds: 3,
      sameGame: true,
    });
    setPlayers(c, x.hp);
    c.state.estimatedLevel = x.level;
    c.rec.currentLevel = x.level;
    c.rec.levelEstimated = !x.screen;
    c.state.screen = x.screen
      ? {
          running: true,
          error: null,
          window: true,
          stage: x.stage,
          gold: x.gold,
          level: x.level,
          xp: x.xp,
          items: [
            "DA_Deathblade",
            "DA_GiantSlayer",
            "DA_Redemption",
            "DA_Component_BFSword",
          ],
          unknownItems: 0,
          shop: shopCards().map((s) => s.id),
          removers: 1,
          augments: null,
        }
      : { ...c.state.screen, running: false };
    c.plan.strategy = strategyFor(x.action, x);
    c.plan.stage = {
      level: x.level,
      board: stageBoard(),
      bankItems: bankItems(),
      shop: x.screen ? shopCards() : [],
      shopRead: x.screen,
      buyNow: buyNow(),
      bridges: [],
      hold: [],
      later: [],
      goalProgress: { onBoard: 4, goal: 9 },
      odds: [],
      note: "",
    };
    c.plan.transitions = transitions();
    c.plan.itemMoves = itemMoves();
    c.plan.carousel = carousel();
    c.rec.decision = decisionFor("ajustar", c);
    c.rec.self.augments = ["Anel de Ouro II", "Pacto Ofensivo"];
    return x;
  }
  function decisionFor(verdict, c) {
    const label = {
      montar: "Montar comp",
      evoluir: "Evoluir a comp atual",
      ajustar: "Ajustar a comp",
      estabilizar: "Estabilizar antes de trocar",
      trocar: "Trocar de comp",
      encerrado: "Partida encerrada",
    }[verdict];
    const by = {
      montar: [
        3,
        0,
        "Início de partida (3 unidades em campo): ainda não há comp para trocar.",
      ],
      evoluir: [7, 1, "A melhor rota mantém 7 de 8 unidades suas; só 1 troca."],
      ajustar: [5, 2, "Mantenha 5 de 7 unidades e troque 2."],
      estabilizar: [
        2,
        5,
        "HP 31 e 18g: trocar 5 de 7 unidades é arriscado agora.",
      ],
      trocar: [2, 5, "Só 2 de 7 unidades suas servem na melhor rota."],
      encerrado: [
        6,
        2,
        "Hero está eliminado neste snapshot; as rotas abaixo servem só para revisão.",
      ],
    }[verdict];
    return {
      verdict,
      label,
      rank: 0,
      title: c.plan.title,
      carry: c.plan.carry,
      kept: by[0],
      leaving: by[1],
      current: by[0] + by[1],
      reasons: [
        by[2],
        "2 item(ns) estão em unidades que sairiam: só troque com a substituta pronta.",
        "2 campeão(ões) a comprar, 1 com cópias em rivais.",
      ],
      note: "Regra heurística sobre o snapshot; não simula combate.",
    };
  }
  /** Mantém só as linhas pedidas na referência (campo e título ficam). */
  function only(c, ...keep) {
    const k = new Set(keep),
      st = c.plan.stage;
    if (!k.has("buy")) st.buyNow = [];
    if (!k.has("equip")) {
      st.bankItems = [];
      st.board.forEach((u) => (u.equipNow = []));
    }
    if (!k.has("build")) st.board.forEach((u) => (u.nextItem = null));
    if (!k.has("moves")) c.plan.itemMoves = [];
    if (!k.has("shop")) st.shop = [];
    if (!k.has("carousel")) c.plan.carousel = [];
    c.plan.transitions = c.plan.transitions.filter(
      (t) =>
        (!t.exit && k.has("free")) ||
        (t.exit && t.ready && k.has("swap")) ||
        (t.exit && !t.ready && k.has("hold")),
    );
  }
  const setRoster = (c, units) => {
    const base = c.rec.currentPlan.board[0];
    c.rec.currentPlan.board = units.map(([ref, stars, items = []]) => ({
      ...base,
      id: ref.id,
      name: ref.name,
      owned: true,
      stars,
      currentStars: stars,
      items,
    }));
  };

  // ---- Cenários ----
  const S = [];
  const add = (group, id, label, hint, build, extra = {}) =>
    S.push({ group, id, label, hint, build, ...extra });
  const G = {
    read: "Leitura e conexão",
    action: "Ação da rodada",
    field: "Campo e volume",
    rows: "Linhas isoladas",
    screen: "Leitura da tela",
    alert: "Alertas e decisões",
  };

  add(
    G.read,
    "carregando",
    "Carregando",
    "A análise ainda não chegou: esqueleto inicial e is-booting.",
    () => {},
    { pending: true },
  );
  add(
    G.read,
    "erro",
    "Erro ao carregar",
    "Primeira leitura falha: faixa de erro, sem conteúdo.",
    () => {},
    {
      fail: "Leitor de snapshot indisponível: o arquivo do jogo não foi publicado.",
    },
  );
  add(
    G.read,
    "erro-depois",
    "Erro após dados",
    "Mostra os dados e, 1,5 s depois, uma atualização falha (conteúdo da última leitura).",
    (c) => live(c),
    { failAfter: 1 },
  );
  add(
    G.read,
    "sem-hero",
    "Hero ausente",
    "O snapshot não traz o Hero.",
    (c) => {
      c.state.players = c.state.players.filter((p) => p.id !== HERO);
    },
  );
  add(
    G.read,
    "aguardando",
    "Sem estratégia",
    "Plano sem estágio nem estratégia: 'Aguardando a leitura' e 'Estratégia indisponível'.",
    (c) => {
      live(c);
      delete c.plan.stage;
      delete c.plan.strategy;
    },
  );
  add(
    G.read,
    "planejamento",
    "Planejamento (snapshot)",
    "Snapshot antigo, não acionável: sem selo Ao vivo, sem verdictos.",
    (c) => {
      live(c);
      patchMeta(c, { actionable: false, phase: "Combate", ageSeconds: 412 });
    },
  );
  add(
    G.read,
    "outro-jogo",
    "Snapshot de outro jogo",
    "Aviso de ID diferente da sessão atual.",
    (c) => {
      live(c);
      patchMeta(c, {
        actionable: false,
        phase: "Combate",
        ageSeconds: 3600,
        sameGame: false,
      });
    },
  );
  add(
    G.read,
    "encerrada",
    "Partida encerrada",
    "Hero eliminado (dados reais): ação ENCERRADA.",
    () => {},
  );

  add(
    G.action,
    "economizar",
    "Economizar",
    "ECONOMIZAR com juros e patamar seguinte.",
    (c) => live(c, { action: "ECONOMIZAR" }),
  );
  add(
    G.action,
    "rolar",
    "Rolar",
    "ROLAR: lojas, piso, chance por rolagem e alvos com rivais.",
    (c) => live(c, { action: "ROLAR", gold: 62, spend: 30, keep: 32 }),
  );
  add(
    G.action,
    "subir-nivel",
    "Subir de nível",
    "SUBIR NÍVEL com custo em ouro.",
    (c) => live(c, { action: "SUBIR NÍVEL", gold: 44, level: 7, xp: "40/68" }),
  );
  add(
    G.action,
    "inicio",
    "Início de partida",
    "Estágio 2-1, nível 3, poucas unidades e ouro baixo.",
    (c) => {
      live(c, {
        action: "ECONOMIZAR",
        level: 3,
        gold: 8,
        xp: "2/6",
        stage: "2-1",
        hp: 100,
      });
      setRoster(c, [
        [VAR, 1],
        [DIA, 1],
        [VI, 1],
      ]);
      c.plan.stage.board = c.plan.stage.board.slice(0, 4);
      c.plan.stage.goalProgress = { onBoard: 2, goal: 5 };
      c.plan.transitions = c.plan.transitions.slice(3);
      c.rec.decision = decisionFor("montar", c);
    },
  );

  add(
    G.field,
    "completo",
    "Tudo preenchido",
    "Todas as linhas da referência ao mesmo tempo.",
    (c) => live(c),
  );
  add(
    G.field,
    "vazio",
    "Campo vazio",
    "Nenhum campeão lido: apenas aviso e linhas vazias.",
    (c) => {
      live(c);
      setRoster(c, []);
      c.plan.stage.board = [];
      c.plan.stage.goalProgress = { onBoard: 0, goal: 9 };
      c.plan.stage.bankItems = [];
      c.plan.itemMoves = [];
      c.plan.transitions = [];
    },
  );
  add(
    G.field,
    "denso",
    "Campo cheio (10 peças)",
    "Dez campeões, todos os itens e linhas: teste de quebra e rolagem.",
    (c) => {
      live(c, { level: 10, gold: 120, xp: "0/0" });
      setRoster(c, [
        [VAR, 2, ["DA_InfinityEdge", "DA_LastWhisper", "DA_SunfireCape"]],
        [DIA, 2],
        [VI, 3, ["DA_SunfireCape"]],
        [NID, 2],
        [AMU, 2],
        [SEN, 3],
        [APH, 1],
        [BRA, 2],
        [XAY, 1],
        [RAK, 1],
      ]);
      c.plan.stage.buyNow = [...buyNow(), ...buyNow().map((u) => ({ ...u }))];
      c.plan.carousel = [
        ...carousel(),
        ...carousel().map((x, i) => ({ ...x, rank: i + 4 })),
      ];
    },
  );
  add(
    G.field,
    "textos-longos",
    "Textos longos",
    "Nomes e justificativas extremos: quebras de linha e overflow.",
    (c) => {
      live(c);
      const long = "Nome extremamente longo de campeão para testar a quebra";
      c.rec.currentPlan.board.slice(0, 2).forEach((u) => (u.name = long));
      c.plan.stage.board.slice(0, 3).forEach((u) => (u.name = long));
      c.plan.stage.buyNow.forEach((u, i) => (u.name = i % 2 ? long : u.name));
      c.plan.stage.bankItems[0].reason =
        "Justificativa muito longa que se estende por várias linhas para validar como o chip se comporta em larguras estreitas e em telas grandes ao mesmo tempo";
      c.plan.transitions[0].reason = c.plan.stage.bankItems[0].reason;
      c.plan.carousel[0].uses[0].reason = c.plan.stage.bankItems[0].reason;
    },
  );

  const row = (id, label, hint, ...keep) =>
    add(G.rows, "linha-" + id, label, hint, (c) => {
      live(c);
      only(c, ...keep);
    });
  row("comprar", "Comprar (alvos)", "Só a faixa tracejada de compras.", "buy");
  row(
    "equipar",
    "Itens · monte e equipe",
    "Itens prontos para equipar e itens do banco.",
    "equip",
  );
  row(
    "trocas",
    "Itens · de quem para quem",
    "Trocas de item (agora vs. planejar).",
    "moves",
  );
  row("proximo", "Itens · próximo", "Próximo item de cada campeão.", "build");
  row("trocar", "Trocar agora", "Só trocas prontas.", "swap");
  row("segure", "Segure", "Só trocas ainda não prontas.", "hold");
  row("vaga", "Vaga livre", "Só entradas em vaga livre.", "free");
  row("loja", "Na loja agora", "Cartas da loja com ação/custo/motivo.", "shop");
  row("carrossel", "Carrossel", "Itens a pegar no carrossel.", "carousel");
  add(
    G.rows,
    "so-campo",
    "Só o campo",
    "Nenhuma recomendação: apenas o título e o elenco.",
    (c) => {
      live(c);
      only(c);
    },
  );

  add(
    G.screen,
    "leitura-completa",
    "Tela lida",
    "Estágio, XP, ouro e nível vindos da tela (barra lateral completa).",
    (c) => live(c, { stage: "5-1", xp: "51/68", gold: 73 }),
  );
  add(
    G.screen,
    "janela-oculta",
    "Janela oculta",
    "Leitor ativo mas a janela do jogo não está visível: ouro/XP sem leitura.",
    (c) => {
      live(c, { screen: false });
      Object.assign(c.state.screen, {
        running: true,
        window: false,
        gold: null,
        level: null,
        xp: null,
        stage: null,
        items: null,
      });
    },
  );
  add(
    G.screen,
    "leitura-erro",
    "Erro do leitor",
    "O leitor de tela devolve erro textual.",
    (c) => {
      live(c, { screen: false });
      Object.assign(c.state.screen, {
        running: true,
        window: true,
        error: "Não foi possível ler o ouro (confiança baixa).",
      });
    },
  );
  add(
    G.screen,
    "manual",
    "Valores manuais",
    "Desliga a estimativa automática e informa ouro à mão.",
    (c) => live(c, { screen: false }),
    {
      after: () => {
        const $ = (id) => document.getElementById(id);
        $("autolevel").checked = false;
        $("level").value = "7";
        $("gold").value = "47";
        $("gold").dispatchEvent(new Event("input", { bubbles: true }));
        $("gold").dispatchEvent(new Event("change", { bubbles: true }));
      },
    },
  );

  add(
    G.alert,
    "aprimoramento",
    "Escolha de aprimoramento",
    "Janela com três cartas (uma recomendada, uma com troca).",
    (c) => {
      live(c);
      c.rec.augmentAdvice = {
        key: "mock-aug-1",
        comp: c.plan.title,
        pick: "b",
        note: "Escolha heurística; confirme no jogo antes de decidir.",
        choices: [
          {
            id: "a",
            name: "Anel de Ouro II",
            desc: "Ganhe 8 de ouro ao final do estágio.",
            reasons: ["Economia boa para o rolo no 4-5."],
            reroll: true,
          },
          {
            id: "b",
            name: "Pacto Ofensivo",
            desc: "Seu carry ganha 15% de dano.",
            reasons: [
              "Aphelios é o carry da comp.",
              "Dá força imediata antes do nível 9.",
            ],
            reroll: false,
          },
          {
            id: "c",
            name: "Caça-Tesouros",
            desc: "Ganhe um componente aleatório.",
            reasons: ["Ajuda a fechar itens."],
            reroll: false,
          },
        ],
      };
    },
  );
  add(
    G.alert,
    "comp-mudou",
    "Comp mudou",
    "Faixa 'A comp mudou' e título da aba com ● (aparece na 2ª leitura).",
    (c) => {
      live(c);
      if (c.n > 0) {
        c.plan.teamCode.code = "FFFF0000000000000000000000000000TFTSet18";
        c.plan.title = "Lunar · Aphelios · Nidalee";
      }
    },
    { follow: true },
  );
  const dec = (v, label, hint) =>
    add(
      G.alert,
      "decisao-" + v,
      "Decisão: " + label,
      hint,
      (c) => {
        live(c, v === "estabilizar" ? { hp: 31, gold: 18 } : {});
        c.rec.decision = decisionFor(v, c);
        if (v === "encerrado") patchMeta(c, { actionable: false });
      },
      { open: true },
    );
  dec("montar", "montar", "Banner 'Montar comp'.");
  dec("evoluir", "evoluir", "Banner 'Evoluir a comp atual'.");
  dec("ajustar", "ajustar", "Banner 'Ajustar a comp'.");
  dec("estabilizar", "estabilizar", "Banner 'Estabilizar antes de trocar'.");
  dec("trocar", "trocar", "Banner 'Trocar de comp'.");
  dec("encerrado", "encerrado", "Banner de partida encerrada (não acionável).");
  add(
    G.alert,
    "movimento",
    "Animação de movimento",
    "A 2ª leitura (1,5 s) move cards entre linhas e reorganiza o restante.",
    (c) => {
      live(c);
      if (c.n === 0) return;
      const st = c.plan.stage;
      c.plan.transitions[2].ready = true; // Segure → Trocar agora
      c.plan.transitions.splice(3, 1); // Xayah deixa a vaga livre
      st.bankItems.reverse();
      st.buyNow.shift();
      c.plan.carousel.reverse();
      setRoster(c, [
        [AMU, 2],
        [VAR, 2],
        [DIA, 2],
        [APH, 1],
        [VI, 2],
        [NID, 2],
      ]);
      st.board.find((u) => u.id === APH.id).owned = true;
    },
    { follow: true },
  );
  add(
    G.alert,
    "detalhes",
    "Detalhes abertos",
    "Abre 'Mais sobre a partida' (ação agora, plano de jogo, aprimoramentos).",
    (c) => live(c),
    { open: true },
  );

  window.LIVE_MOCK_SCENARIOS = S.map(({ id, group, label, hint }) => ({
    id,
    group,
    label,
    hint,
  }));
  const current = S.find((s) => s.id === qs.get("mock"));
  if (!qs.has("mock")) return;

  // ---- Interceptação de rede ----
  const realFetch = window.fetch.bind(window);
  const base = realFetch("/live-mock-base.json").then((r) => r.json());
  const calls = { state: 0, rec: 0 };
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const buildCtx = async (n) => {
    const { state, rec } = clone(await base),
      c = { state, rec, plan: rec.recommendations[0], n };
    current?.build(c);
    if (current?.follow)
      state.modifiedAt = rec.metadata.modifiedAt = new Date(
        Date.parse(state.modifiedAt) + n * 1000,
      ).toISOString();
    return c;
  };
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input.url,
      location.href,
    );
    if (url.pathname === "/api/state") {
      const n = calls.state++;
      await sleep(80);
      if (current?.failAfter && n >= current.failAfter)
        return json(500, { error: "Falha ao atualizar a leitura (simulada)." });
      return json(200, (await buildCtx(n)).state);
    }
    if (url.pathname === "/api/recommend") {
      const n = calls.rec++;
      if (current?.pending) return new Promise(() => {});
      await sleep(150);
      if (current?.fail) return json(500, { error: current.fail });
      return json(200, (await buildCtx(n)).rec);
    }
    return realFetch(input, init);
  };

  // ---- Seletor flutuante ----
  const here = () => S.findIndex((s) => s.id === current?.id);
  const go = (id, open = params.open) => {
    const next = new URLSearchParams({ mock: id });
    if (open || S.find((s) => s.id === id)?.open) next.set("open", "1");
    location.assign(`${location.pathname}?${next}${location.hash || "#live"}`);
  };
  addEventListener("keydown", (e) => {
    if (
      e.target.closest?.("input,select,textarea") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return;
    const i = here();
    if (e.key === "]") go(S[(i + 1) % S.length].id);
    if (e.key === "[") go(S[(i - 1 + S.length) % S.length].id);
  });
  addEventListener("DOMContentLoaded", () => {
    const framed = window.top !== window;
    const style = document.createElement("style");
    style.textContent = `#mockbar{position:fixed;left:0;right:0;bottom:0;z-index:99999;font:12px/1.4 system-ui,sans-serif;background:#0b141d;color:#d8e6f2;border-top:2px solid #c8963d;box-shadow:0 -8px 24px #0008}
#mockbar summary{cursor:pointer;padding:7px 14px;display:flex;gap:12px;align-items:center;list-style:none;font-weight:700}
#mockbar summary::-webkit-details-marker{display:none}
#mockbar summary em{font-style:normal;font-weight:400;color:#9db6c9;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mockbar .mock-body{max-height:32vh;overflow:auto;padding:4px 14px 12px;display:grid;gap:8px}
#mockbar h5{margin:6px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#c8963d}
#mockbar button,#mockbar a.mock-link{font:inherit;color:#d8e6f2;background:#142331;border:1px solid #2a4052;border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;cursor:pointer;text-decoration:none;display:inline-block}
#mockbar button:hover,#mockbar a.mock-link:hover{border-color:#75bcac}
#mockbar button[aria-current="true"]{background:#c8963d;border-color:#c8963d;color:#10171e;font-weight:700}
body{padding-bottom:var(--mockbar-h,48px)}`;
    if (!framed) document.head.append(style);
    const bar = document.createElement("details");
    bar.id = "mockbar";
    bar.open = sessionStorage.getItem("mockbar") === "open";
    const groups = [...new Set(S.map((s) => s.group))];
    bar.innerHTML = `<summary><span>MOCK</span><span>${current ? current.label : "cenário desconhecido"}</span><em>${current ? current.hint : "Escolha um cenário abaixo."}</em><span>[ anterior · ] próximo</span></summary><div class="mock-body">${groups
      .map(
        (g) =>
          `<div><h5>${g}</h5>${S.filter((s) => s.group === g)
            .map(
              (s) =>
                `<button type="button" data-mock="${s.id}" title="${s.hint}" ${s.id === current?.id ? 'aria-current="true"' : ""}>${s.label}</button>`,
            )
            .join("")}</div>`,
      )
      .join(
        "",
      )}<div><h5>Ferramentas</h5><button type="button" data-open>${params.open ? "Fechar" : "Abrir"} “Mais sobre a partida”</button><a class="mock-link" href="/live-mock.html">Galeria de todos os cenários ↗</a><a class="mock-link" href="/#live">Sair do mock ↗</a></div></div>`;
    if (!framed) document.body.append(bar);
    const fit = () =>
      document.body.style.setProperty(
        "--mockbar-h",
        bar.offsetHeight + 8 + "px",
      );
    bar.addEventListener("toggle", () => {
      sessionStorage.setItem("mockbar", bar.open ? "open" : "closed");
      fit();
    });
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mock]");
      if (b) go(b.dataset.mock);
      if (e.target.closest("[data-open]"))
        go(current?.id ?? S[0].id, !params.open);
    });
    fit();
    // Passos pós-carga (abrir detalhes, preencher campos manuais, segunda leitura).
    const settle = async () => {
      for (
        let i = 0;
        i < 60 && document.body.classList.contains("is-booting");
        i++
      )
        await sleep(100);
      if (params.open || current?.open)
        for (const d of document.querySelectorAll(
          "#live details.reference-more, #live details.reference-more > details:not(.source-details):not(.read-settings)",
        ))
          d.open = true;
      current?.after?.();
      if (current?.follow || current?.failAfter) {
        await sleep(1500);
        document.dispatchEvent(new Event("visibilitychange"));
      }
    };
    void settle();
  });
})();

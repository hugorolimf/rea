/**
 * Preferências do app (tema, movimento, HUD fixo...) e armazenamento seguro. Puro: o armazenamento entra por parâmetro,
 * então roda no Node e nos testes; no navegador o main.js passa `safeStorage()`.
 */

/** Chave única das preferências no localStorage (um objeto JSON). */
export const PREFS_KEY = "tft-compass-prefs";

/**
 * Armazenamento que nunca lança: tenta o `localStorage` (que pode estar bloqueado, cheio ou ausente) e guarda uma
 * cópia em memória, que vale enquanto a página estiver aberta se a gravação falhar.
 * @param {() => Storage} [getStorage]
 */
export function safeStorage(getStorage = () => localStorage) {
  const session = new Map();
  let backing = null;
  try {
    backing = getStorage();
    // Navegadores com armazenamento bloqueado lançam só no primeiro acesso ou na gravação.
    backing.getItem("__tft_probe__");
  } catch {
    backing = null;
  }
  return {
    getItem(key) {
      if (session.has(key)) return session.get(key);
      try {
        return backing?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      session.set(key, String(value));
      try {
        backing?.setItem(key, String(value));
      } catch {
        // Cota cheia ou modo privado: a cópia em memória cobre a sessão.
      }
    },
    removeItem(key) {
      session.delete(key);
      try {
        backing?.removeItem(key);
      } catch {
        // idem
      }
    },
    /** `true` quando as preferências sobrevivem ao fechar a página. */
    get persistent() {
      return backing !== null;
    },
  };
}

/** Valores aceitos por preferência: o que não bate volta ao padrão (JSON editado à mão, versão antiga). */
export const PREF_SPECS = {
  /** `auto` segue o sistema (prefers-color-scheme). */
  theme: {
    fallback: "auto",
    valid: (v) => ["auto", "light", "dark"].includes(v),
  },
  /** `auto` segue prefers-reduced-motion; `reduce` força menos movimento. */
  motion: { fallback: "auto", valid: (v) => ["auto", "reduce"].includes(v) },
  /** HUD fixo no topo ao rolar o Ao vivo (em janelas altas). */
  stickyHud: { fallback: true, valid: (v) => typeof v === "boolean" },
  /** O convite para instalar o app foi dispensado. */
  installDismissed: { fallback: false, valid: (v) => typeof v === "boolean" },
};

/** Todas as preferências com padrão aplicado; ignora chaves desconhecidas. */
export function normalizePrefs(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [key, spec] of Object.entries(PREF_SPECS))
    out[key] = spec.valid(src[key]) ? src[key] : spec.fallback;
  return out;
}

/** Lê o objeto de preferências guardado (padrão se ausente ou corrompido). */
export function readPrefs(storage) {
  try {
    return normalizePrefs(JSON.parse(storage.getItem(PREFS_KEY) ?? "null"));
  } catch {
    return normalizePrefs(null);
  }
}

/**
 * Preferências com notificação. `set` valida, grava e avisa os assinantes só se o valor mudou.
 * @param {{ getItem(k: string): string | null, setItem(k: string, v: string): void }} storage
 */
export function createPrefs(storage) {
  let state = readPrefs(storage);
  const listeners = new Set();
  return {
    get: (key) => state[key],
    all: () => ({ ...state }),
    set(key, value) {
      const spec = PREF_SPECS[key];
      if (!spec || !spec.valid(value) || state[key] === value) return false;
      state = { ...state, [key]: value };
      try {
        storage.setItem(PREFS_KEY, JSON.stringify(state));
      } catch {
        // Sem gravação: vale só nesta página.
      }
      for (const fn of listeners) fn(key, value, state);
      return true;
    },
    /** Assina mudanças; devolve a função que cancela. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Próximo tema do botão da barra: segue o sistema → claro → escuro → sistema. */
export const nextTheme = (theme) =>
  ({ auto: "light", light: "dark", dark: "auto" })[theme] ?? "auto";

/** Tema efetivo (claro/escuro) dada a preferência e o que o sistema pede. */
export const effectiveTheme = (theme, systemDark) =>
  theme === "light" || theme === "dark" ? theme : systemDark ? "dark" : "light";

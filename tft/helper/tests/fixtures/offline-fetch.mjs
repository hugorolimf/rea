// Pré-carregado com `node --import`: toda requisição de rede falha como num computador sem internet.
globalThis.fetch = async () => {
  throw Object.assign(TypeError("fetch failed"), {
    cause: { code: "ENOTFOUND" },
  });
};

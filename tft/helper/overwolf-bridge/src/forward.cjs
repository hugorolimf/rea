"use strict";
// Encaminhamento opcional (desligado por padrao) dos registros ja filtrados para um receptor LOCAL do helper.
// So aceita 127.0.0.1, localhost ou ::1; qualquer outro destino e recusado.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function createForwarder(rawUrl, fetchImpl = globalThis.fetch) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("BRIDGE_FORWARD_URL invalida");
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname))
    throw new Error(
      "BRIDGE_FORWARD_URL deve ser http://127.0.0.1, localhost ou [::1]",
    );
  return (record) => {
    void fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(1500),
    }).catch(() => {});
  };
}

module.exports = { createForwarder };

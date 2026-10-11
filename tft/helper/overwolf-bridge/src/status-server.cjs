"use strict";
// Servidor HTTP somente em 127.0.0.1: GET /health e GET /status (contadores e estado, nunca o conteudo dos eventos).
// Sem CORS de proposito: paginas de outros sites nao leem a resposta.
const http = require("node:http");

function createStatusServer(
  getStatus,
  { port = 18795, host = "127.0.0.1" } = {},
) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (
      req.method !== "GET" ||
      (url.pathname !== "/health" && url.pathname !== "/status")
    ) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.stringify(
      url.pathname === "/health" ? { ok: true } : getStatus(),
    );
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(body);
  });
  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address()));
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { createStatusServer };

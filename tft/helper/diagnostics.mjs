// Diagnóstico do servidor local: log em arquivo, erros não tratados que não derrubam o processo
// e detecção de que a execução anterior terminou sem registrar saída (morta à força ou queda).
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

const MAX_LOG_BYTES = 1_000_000;
// Se erros não tratados chegarem nesse ritmo, o processo está em loop de falha: melhor sair do que ficar zumbi.
const FAILURE_BURST = { count: 40, windowMs: 60_000 };

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/**
 * Instala o log e os handlers de processo. Devolve `{ write }` para registrar eventos.
 * `runFile` guarda o PID da execução atual; na próxima partida ele revela encerramentos anormais.
 */
export function installDiagnostics(logFile, runFile, { port } = {}) {
  const write = (level, message) => {
    try {
      if (existsSync(logFile) && statSync(logFile).size > MAX_LOG_BYTES)
        renameSync(logFile, `${logFile}.1`);
      appendFileSync(
        logFile,
        `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`,
      );
    } catch {
      // Log nunca pode derrubar o servidor.
    }
  };

  if (existsSync(runFile)) {
    try {
      const previous = JSON.parse(readFileSync(runFile, "utf8"));
      if (previous.pid !== process.pid && !isAlive(previous.pid))
        write(
          "AVISO",
          `execução anterior (PID ${previous.pid}, desde ${previous.startedAt}) terminou sem registrar saída: encerrada à força (Stop-Process, janela fechada) ou queda do sistema; não houve erro não tratado registrado`,
        );
    } catch {
      // Arquivo de execução ilegível: ignora.
    }
  }
  try {
    writeFileSync(
      runFile,
      JSON.stringify({
        pid: process.pid,
        port,
        startedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Sem permissão para gravar: segue sem a detecção.
  }
  write("INFO", `iniciado (PID ${process.pid}, porta ${port})`);

  const burst = [];
  const failure = (kind, error) => {
    write("ERRO", `${kind}: ${error?.stack ?? error}`);
    const now = Date.now();
    burst.push(now);
    while (burst.length && now - burst[0] > FAILURE_BURST.windowMs)
      burst.shift();
    if (burst.length >= FAILURE_BURST.count) {
      write(
        "ERRO",
        `${burst.length} falhas em ${FAILURE_BURST.windowMs / 1000}s: encerrando para não ficar em estado inconsistente`,
      );
      process.exit(1);
    }
  };
  process.on("uncaughtException", (error, origin) =>
    failure(`exceção não tratada (${origin})`, error),
  );
  process.on("unhandledRejection", (reason) =>
    failure("promessa rejeitada sem tratamento", reason),
  );
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"])
    process.on(signal, () => {
      write("INFO", `recebeu ${signal}; encerrando`);
      process.exit(0);
    });
  process.on("exit", (code) => {
    write("INFO", `encerrado (código ${code})`);
    try {
      unlinkSync(runFile);
    } catch {
      // Já removido.
    }
  });
  return { write };
}

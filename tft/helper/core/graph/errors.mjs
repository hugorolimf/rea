/**
 * Erro do grafo de fatos. `code` é estável (os testes e os chamadores decidem por ele, não pelo texto):
 *
 * - `INVALID`: argumento de `defineFact`/`createGraph`/`set` mal formado.
 * - `DUPLICATE`: dois fatos (ou um fato e uma entrada) com o mesmo nome.
 * - `UNKNOWN_NODE`: fato que depende de um nome que não é entrada nem fato; `get` de nome desconhecido.
 * - `UNKNOWN_INPUT`: `set` de uma entrada que não foi declarada em `createGraph`.
 * - `CYCLE`: dependências circulares (`details.cycle` traz o caminho).
 * - `MISSING_INPUT`: um fato precisa de uma entrada que ainda não recebeu valor.
 * - `UNDECLARED_INPUT`: a função do fato leu uma entrada que não declarou (o defeito D1).
 * - `READONLY_INPUT`: a função do fato tentou escrever nas entradas.
 * - `UNSERIALIZABLE`: valor sem chave estável (função, símbolo, ciclo de objetos, `Promise`...).
 * - `REENTRANT`: `get`/`set` chamado de dentro da função de um fato.
 * - `ASYNC_FACT`: a função do fato devolveu uma `Promise` (fatos são síncronos).
 * - `IMPURE`: no modo `verify`, o fato mudou uma entrada ou deu saídas diferentes para as mesmas entradas.
 * - `COMPUTE_FAILED`: a função do fato lançou um erro (`cause` guarda o original).
 */
export class GraphError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: unknown, [extra: string]: unknown }} [details]
   */
  constructor(code, message, details = {}) {
    const { cause, ...extra } = details;
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GraphError";
    this.code = code;
    this.details = extra;
  }
}

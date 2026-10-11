/**
 * Uma única conexão SSE por origem, compartilhada entre abas e iframes.
 *
 * O navegador permite só 6 conexões simultâneas por origem (HTTP/1.1). Como cada página abria seu
 * próprio EventSource, poucas abas (ou uma galeria com dezenas de iframes) esgotavam o limite e tudo
 * ficava "carregando". Aqui uma aba vence o Web Lock e mantém o EventSource; as demais recebem os
 * mesmos eventos por BroadcastChannel. Se a aba líder fechar, o lock passa para a próxima.
 */
const NAME = "tft-helper-events";

/**
 * Assina os eventos do jogo. `onMessage(texto)` recebe cada `data:`; `onError()` avisa que a
 * conexão caiu. Devolve uma função que encerra a assinatura.
 */
export function shareEvents(
  onMessage,
  onError = () => {},
  url = "/api/events",
  onOpen = () => {},
) {
  if (!("locks" in navigator) || typeof BroadcastChannel === "undefined") {
    // Navegador sem Web Locks: conexão própria, como antes.
    const source = new EventSource(url);
    source.onmessage = (e) => onMessage(e.data);
    source.onopen = onOpen;
    source.onerror = onError;
    return () => source.close();
  }
  const channel = new BroadcastChannel(NAME),
    abort = new AbortController();
  let release = () => {};
  channel.onmessage = ({ data }) =>
    data.type === "message"
      ? onMessage(data.text)
      : data.type === "open"
        ? onOpen()
        : onError();
  navigator.locks
    .request(
      NAME,
      { signal: abort.signal },
      () =>
        new Promise((resolve) => {
          const source = new EventSource(url);
          source.onmessage = (e) => {
            channel.postMessage({ type: "message", text: e.data });
            onMessage(e.data);
          };
          source.onopen = () => {
            channel.postMessage({ type: "open" });
            onOpen();
          };
          source.onerror = () => {
            channel.postMessage({ type: "error" });
            onError();
          };
          release = () => {
            source.close();
            resolve();
          };
        }),
    )
    .catch(() => {}); // AbortError ao encerrar a assinatura enquanto esperava o lock.
  return () => {
    abort.abort();
    release();
    channel.close();
  };
}

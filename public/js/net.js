// Socket connection with promise-based requests.
/* global io */

const REQUEST_TIMEOUT_MS = 8000;

export function createNet() {
  const socket = io({
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  /**
   * Sends a request and resolves with the server's reply:
   * { ok: true, ... } or { ok: false, error }. Never rejects.
   */
  function request(event, payload = {}) {
    return new Promise((resolve) => {
      if (!socket.connected) {
        resolve({ ok: false, error: 'You are offline — reconnecting…', code: 'OFFLINE' });
        return;
      }
      socket.timeout(REQUEST_TIMEOUT_MS).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, error: 'The server did not respond. Check your connection.', code: 'TIMEOUT' });
        else resolve(res && typeof res === 'object' ? res : { ok: false, error: 'Unexpected server response.' });
      });
    });
  }

  return {
    socket,
    request,
    on: (event, handler) => socket.on(event, handler),
    get connected() {
      return socket.connected;
    },
  };
}

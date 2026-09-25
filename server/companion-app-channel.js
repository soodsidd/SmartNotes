/**
 * SN-203 companion→app socket coordinator.
 *
 * `app_send` (server-side vault tool) needs to reach a mini-app running inside a
 * browser iframe. The only server→browser path is socket.io, so this coordinator
 * broadcasts a `companion_app_deliver` request to every connected client and
 * collects `companion_app_deliver_ack` replies within a short window. A client
 * acks only when it currently has a LIVE instance of the target app on the
 * matching page, which is how delivery distinguishes a running instance
 * (cross-page, any open tab) from "app not running".
 *
 * Delivery is ephemeral by construction: nothing is queued and nothing is
 * replayed. If no client acks in the window, the result is delivered:false.
 */

const DEFAULT_DELIVER_TIMEOUT_MS = 1500;

function createCompanionAppChannel({ io, timeoutMs = DEFAULT_DELIVER_TIMEOUT_MS } = {}) {
  const pending = new Map();
  let counter = 0;

  function deliver({ path, message, timeoutMs: overrideTimeout } = {}) {
    if (!io || typeof io.emit !== "function") {
      return Promise.resolve({ delivered: false, instances: 0, reason: "channel-unavailable" });
    }
    const deliveryId = `d_${Date.now().toString(36)}_${(++counter).toString(36)}`;
    return new Promise((resolve) => {
      const entry = { acks: new Set(), timer: null, resolve };
      const settle = () => {
        if (!pending.has(deliveryId)) return;
        pending.delete(deliveryId);
        if (entry.timer) clearTimeout(entry.timer);
        const instances = entry.acks.size;
        resolve({ delivered: instances > 0, instances });
      };
      entry.settle = settle;
      pending.set(deliveryId, entry);
      entry.timer = setTimeout(settle, Math.max(1, overrideTimeout || timeoutMs));
      if (typeof entry.timer?.unref === "function") entry.timer.unref();
      io.emit("companion_app_deliver", { deliveryId, path, message });
    });
  }

  function ack(deliveryId, clientId) {
    if (typeof deliveryId !== "string") return;
    const entry = pending.get(deliveryId);
    if (!entry) return;
    entry.acks.add(clientId || `anon_${entry.acks.size}`);
    // The broadcast already reached every connected client. The tool only needs
    // to know whether at least one live target accepted it, so do not hold the
    // companion turn open for the rest of the timeout window after the first ack.
    entry.settle();
  }

  /** Register the ack handler on a freshly connected socket. */
  function attach(socket) {
    if (!socket || typeof socket.on !== "function") return;
    socket.on("companion_app_deliver_ack", (payload) => {
      if (payload && typeof payload.deliveryId === "string") {
        ack(payload.deliveryId, socket.id);
      }
    });
  }

  return { deliver, ack, attach };
}

module.exports = { createCompanionAppChannel, DEFAULT_DELIVER_TIMEOUT_MS };

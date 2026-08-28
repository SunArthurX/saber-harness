/**
 * S27 renderer bridge allowlist.
 *
 * The renderer may invoke EXACTLY these typed Saber intents — nothing
 * else. There is no generic send, no filesystem, shell, network or
 * Electron surface here: the bridge only forwards validated intent
 * names and serializable payloads through whatever narrow channel the
 * shell injects later (preload/extension host), and unknown names fail
 * closed before any forwarding. This module must stay dependency-free.
 */

/** Frozen bridge method registry (static allowlist, S27-WP04). */
const BRIDGE_METHODS = Object.freeze([
  "saber.core.initialize",
  "saber.core.health",
  "saber.events.subscribe",
  "saber.workbench.status",
]);

const METHOD_SET = new Set(BRIDGE_METHODS);

/** True when `name` is one of the frozen bridge intents. */
function isBridgeMethod(name) {
  return typeof name === "string" && METHOD_SET.has(name);
}

/** Maximum payload size accepted by the bridge (matches frame policy). */
const MAX_BRIDGE_PAYLOAD_BYTES = 1024 * 1024;

/**
 * Create the bridge dispatcher over an injected one-way channel. The
 * channel is opaque: the bridge never assumes ipc/Electron semantics.
 * Returns an async function (method, payload) => result.
 */
function createSaberBridge(sendIntent) {
  if (typeof sendIntent !== "function") {
    throw new Error("bridge requires an injected intent channel");
  }
  return Object.freeze(async function saberBridge(method, payload) {
    if (!isBridgeMethod(method)) {
      throw new Error("unknown_bridge_method");
    }
    const serialized = JSON.stringify(payload === undefined ? {} : payload);
    if (serialized.length > MAX_BRIDGE_PAYLOAD_BYTES) {
      throw new Error("bridge_payload_too_large");
    }
    return sendIntent(method, JSON.parse(serialized));
  });
}

module.exports = {
  BRIDGE_METHODS,
  MAX_BRIDGE_PAYLOAD_BYTES,
  createSaberBridge,
  isBridgeMethod,
};

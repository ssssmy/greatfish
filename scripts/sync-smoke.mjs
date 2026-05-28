// End-to-end sync smoke test.
// Spins up TWO Yjs clients both connected to the local PartyKit dev server,
// in the same room ("work-tea"). Client A writes a sticky into the Y.Map,
// Client B should receive it via PartyKit's sync. If the round-trip works,
// the script exits 0; otherwise 1 after a 10s timeout.

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { WebSocket as WsBase } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;
if (agent) console.error(`[smoke] tunneling WS via ${PROXY}`);

class WebSocket extends WsBase {
  constructor(url, protocols, options) {
    super(url, protocols, { ...options, agent });
  }
}

// Node doesn't have a global WebSocket suitable for y-partykit's provider in
// older versions, so we force the ws polyfill.
const HOST = process.env.PARTY_HOST ?? "127.0.0.1:1999";
const ROOM = process.env.ROOM ?? "work-tea-smoke-" + Date.now();

const docA = new Y.Doc();
const docB = new Y.Doc();

const providerA = new YPartyKitProvider(HOST, ROOM, docA, {
  party: "main",
  WebSocketPolyfill: WebSocket,
});
const providerB = new YPartyKitProvider(HOST, ROOM, docB, {
  party: "main",
  WebSocketPolyfill: WebSocket,
});

const mapA = docA.getMap("stickies");
const mapB = docB.getMap("stickies");

const PAYLOAD = { id: "smoke-id", x: 100, y: 200, text: "hello from A" };

let resolved = false;
const settle = (ok, reason) => {
  if (resolved) return;
  resolved = true;
  console.log(ok ? "✅ SYNC OK" : "❌ SYNC FAIL");
  if (reason) console.log("reason:", reason);
  try {
    providerA.destroy();
  } catch {}
  try {
    providerB.destroy();
  } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 100);
};

mapB.observe(() => {
  const got = mapB.get("smoke-id");
  if (got && got.text === PAYLOAD.text) {
    settle(true);
  }
});

setTimeout(() => settle(false, "10s timeout — B did not receive A's write"), 10_000);

function waitConnected(provider) {
  return new Promise((res) => {
    if (provider.wsconnected) return res();
    const handler = (e) => {
      if (e.status === "connected") {
        provider.off("status", handler);
        res();
      }
    };
    provider.on("status", handler);
  });
}

Promise.all([waitConnected(providerA), waitConnected(providerB)]).then(() => {
  console.log("both providers connected, writing on A...");
  mapA.set("smoke-id", PAYLOAD);
});

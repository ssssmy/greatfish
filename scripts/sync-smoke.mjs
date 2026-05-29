// End-to-end sync smoke test.
//
// Spins up TWO Yjs clients (with two distinct identities) both connected to
// the local PartyKit server in the same room. Client A writes a sticky owned
// by A; Client B should receive it via the server's sync. Validates:
//   - server-side auth gate (identity query param required)
//   - server-side ownership (A can write A's own sticky)
//   - sync still propagates
//
// Exits 0 on round-trip; 1 after 10s timeout otherwise.

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { WebSocket as WsBase } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:1999";
const ROOM = process.env.ROOM ?? "work-tea-smoke-" + Date.now();

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;
if (agent) console.error(`[smoke] tunneling WS via ${PROXY}`);

class WebSocket extends WsBase {
  constructor(url, protocols, options) {
    super(url, protocols, { ...options, agent });
  }
}

const IDENTITY_A = {
  id: "smokeAaaaaa",
  name: "Smoke A",
  color: "#a855f7",
};

const IDENTITY_B = {
  id: "smokeBbbbbb",
  name: "Smoke B",
  color: "#10b981",
};

function encodeIdentity(id) {
  return Buffer.from(JSON.stringify(id), "utf8").toString("base64");
}

function makeProvider(identity) {
  const doc = new Y.Doc();
  const provider = new YPartyKitProvider(HOST, ROOM, doc, {
    party: "main",
    WebSocketPolyfill: WebSocket,
    params: { identity: encodeIdentity(identity) },
  });
  return { doc, provider, map: doc.getMap("stickies") };
}

const a = makeProvider(IDENTITY_A);
const b = makeProvider(IDENTITY_B);

const STICKY_ID = "smoke" + Date.now().toString(36);
const PAYLOAD = {
  id: STICKY_ID,
  x: 100,
  y: 200,
  text: "hello from A",
  color: IDENTITY_A.color,
  authorId: IDENTITY_A.id,
  authorName: IDENTITY_A.name,
  ts: Date.now(),
};

let resolved = false;
const settle = (ok, reason) => {
  if (resolved) return;
  resolved = true;
  console.log(ok ? "✅ SYNC OK" : "❌ SYNC FAIL");
  if (reason) console.log("reason:", reason);
  try { a.provider.destroy(); } catch {}
  try { b.provider.destroy(); } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 100);
};

b.map.observe(() => {
  const got = b.map.get(STICKY_ID);
  if (got && got.text === PAYLOAD.text) settle(true);
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

Promise.all([waitConnected(a.provider), waitConnected(b.provider)]).then(() => {
  console.log("both providers connected (A=" + IDENTITY_A.id + ", B=" + IDENTITY_B.id + ")");
  a.map.set(STICKY_ID, PAYLOAD);
});

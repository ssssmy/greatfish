// Security regression: replay Shannon's attacks against the new server.
//
// Each test:
//   1. Connects a "witness" client (the threat surface — what other users
//      and the admin actually see, from the server's authoritative state).
//   2. Connects an attacker, makes them try the attack.
//   3. Verifies the WITNESS does not see the malicious change.
//
// Why witness-based: y-partykit applies all writes locally first, so the
// attacker's own `map.get(id)` will always show their own write. The real
// security boundary is whether the server propagates the change to anyone
// else.

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { WebSocket as WsBase } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:50704";
const ROOM = "regression-" + Date.now().toString(36);

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;
if (agent) console.error(`[reg] tunneling WS via ${PROXY}`);

class WebSocket extends WsBase {
  constructor(url, protocols, options) {
    super(url, protocols, { ...options, agent });
  }
}

function encodeIdentity(id) {
  return Buffer.from(JSON.stringify(id), "utf8").toString("base64");
}

const WITNESS = { id: "witness0001", name: "Witness", color: "#0ea5e9" };
const ATTACKER = { id: "regress0001", name: "Attacker", color: "#a855f7" };
const VICTIM = { id: "victim00001", name: "Victim", color: "#10b981" };

function makeProvider(room, params) {
  const doc = new Y.Doc();
  const provider = new YPartyKitProvider(HOST, room, doc, {
    party: "main",
    WebSocketPolyfill: WebSocket,
    params,
  });
  return { doc, provider, map: doc.getMap("stickies") };
}

function waitConnected(provider, timeoutMs = 3000) {
  return new Promise((res, rej) => {
    if (provider.wsconnected) return res();
    const onStatus = (e) => {
      if (e.status === "connected") {
        provider.off("status", onStatus);
        res();
      }
    };
    provider.on("status", onStatus);
    setTimeout(() => {
      provider.off("status", onStatus);
      rej(new Error("connect timeout"));
    }, timeoutMs);
  });
}

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}  ${detail ?? ""}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────

async function test_no_identity_rejected() {
  const room = ROOM + "-noid";
  const { provider } = makeProvider(room, {});
  try {
    await waitConnected(provider, 2500);
    await new Promise((r) => setTimeout(r, 800));
    record(
      "auth-vuln-03 no-identity rejected",
      !provider.wsconnected,
      provider.wsconnected ? "still connected" : "disconnected by server",
    );
  } catch (e) {
    record("auth-vuln-03 no-identity rejected", true, "connect failed: " + e.message);
  } finally {
    provider.destroy();
  }
}

async function test_create_other_user_sticky_rejected() {
  const room = ROOM + "-spoof";
  const witness = makeProvider(room, { identity: encodeIdentity(WITNESS) });
  await waitConnected(witness.provider);
  await new Promise((r) => setTimeout(r, 300));

  const attacker = makeProvider(room, { identity: encodeIdentity(ATTACKER) });
  await waitConnected(attacker.provider);
  await new Promise((r) => setTimeout(r, 300));

  const noteId = "spoof" + Date.now();
  attacker.map.set(noteId, {
    id: noteId,
    x: 0,
    y: 0,
    text: "spoof",
    color: "#888888",
    authorId: VICTIM.id, // SPOOFING
    authorName: VICTIM.name,
    ts: Date.now(),
  });

  await new Promise((r) => setTimeout(r, 1500));

  const inWitness = !!witness.map.get(noteId);
  record(
    "authz-vuln-01 spoof-author not broadcast",
    !inWitness,
    inWitness ? "witness saw the spoof!" : "server suppressed broadcast",
  );
  attacker.provider.destroy();
  witness.provider.destroy();
}

async function test_create_xss_color_rejected() {
  const room = ROOM + "-xss";
  const witness = makeProvider(room, { identity: encodeIdentity(WITNESS) });
  await waitConnected(witness.provider);
  await new Promise((r) => setTimeout(r, 300));

  const attacker = makeProvider(room, { identity: encodeIdentity(ATTACKER) });
  await waitConnected(attacker.provider);
  await new Promise((r) => setTimeout(r, 300));

  const noteId = "xss" + Date.now();
  attacker.map.set(noteId, {
    id: noteId,
    x: 0,
    y: 0,
    text: "innocent",
    color: 'url("https://attacker.example.com/beacon")',
    authorId: ATTACKER.id,
    authorName: ATTACKER.name,
    ts: Date.now(),
  });

  await new Promise((r) => setTimeout(r, 1500));

  const inWitness = !!witness.map.get(noteId);
  record(
    "xss-vuln-01 css-url() color not broadcast",
    !inWitness,
    inWitness ? "witness saw the xss color!" : "server suppressed broadcast",
  );
  attacker.provider.destroy();
  witness.provider.destroy();
}

async function test_delete_other_user_sticky_rejected() {
  const room = ROOM + "-delother";

  // Victim creates legit sticky owned by them
  const victim = makeProvider(room, { identity: encodeIdentity(VICTIM) });
  await waitConnected(victim.provider);
  await new Promise((r) => setTimeout(r, 300));
  const noteId = "victim" + Date.now();
  victim.map.set(noteId, {
    id: noteId,
    x: 0,
    y: 0,
    text: "mine",
    color: "#10b981",
    authorId: VICTIM.id,
    authorName: VICTIM.name,
    ts: Date.now(),
  });
  await new Promise((r) => setTimeout(r, 800));

  // Witness joins to observe the canonical state
  const witness = makeProvider(room, { identity: encodeIdentity(WITNESS) });
  await waitConnected(witness.provider);
  await new Promise((r) => setTimeout(r, 500));
  if (!witness.map.get(noteId)) {
    record("authz-vuln-01 delete-other not propagated", false, "witness never saw victim's sticky");
    victim.provider.destroy();
    witness.provider.destroy();
    return;
  }

  // Attacker tries to delete
  const attacker = makeProvider(room, { identity: encodeIdentity(ATTACKER) });
  await waitConnected(attacker.provider);
  await new Promise((r) => setTimeout(r, 300));
  attacker.map.delete(noteId);
  await new Promise((r) => setTimeout(r, 1500));

  const stillThereForWitness = !!witness.map.get(noteId);
  record(
    "authz-vuln-01 delete-other not propagated",
    stillThereForWitness,
    stillThereForWitness ? "witness still sees victim's sticky" : "deletion was propagated!",
  );
  attacker.provider.destroy();
  victim.provider.destroy();
  witness.provider.destroy();
}

async function test_sensitive_word_rejected_server_side() {
  const room = ROOM + "-word";
  const witness = makeProvider(room, { identity: encodeIdentity(WITNESS) });
  await waitConnected(witness.provider);
  await new Promise((r) => setTimeout(r, 300));

  const attacker = makeProvider(room, { identity: encodeIdentity(ATTACKER) });
  await waitConnected(attacker.provider);
  await new Promise((r) => setTimeout(r, 300));

  const noteId = "word" + Date.now();
  attacker.map.set(noteId, {
    id: noteId,
    x: 0,
    y: 0,
    text: "代刷 高薪兼职 加微信",
    color: "#888888",
    authorId: ATTACKER.id,
    authorName: ATTACKER.name,
    ts: Date.now(),
  });

  await new Promise((r) => setTimeout(r, 1500));

  const inWitness = !!witness.map.get(noteId);
  record(
    "authz-vuln-06 sensitive-word not broadcast",
    !inWitness,
    inWitness ? "witness saw banned text!" : "server suppressed broadcast",
  );
  attacker.provider.destroy();
  witness.provider.destroy();
}

async function test_rate_limit_server_side() {
  const room = ROOM + "-rate";
  const witness = makeProvider(room, { identity: encodeIdentity(WITNESS) });
  await waitConnected(witness.provider);
  await new Promise((r) => setTimeout(r, 300));

  const attacker = makeProvider(room, { identity: encodeIdentity(ATTACKER) });
  await waitConnected(attacker.provider);
  await new Promise((r) => setTimeout(r, 300));

  for (let i = 0; i < 30; i++) {
    const id = "spam" + i + "x" + Date.now();
    attacker.map.set(id, {
      id,
      x: i * 10,
      y: 0,
      text: "spam " + i,
      color: "#888888",
      authorId: ATTACKER.id,
      authorName: ATTACKER.name,
      ts: Date.now(),
    });
  }

  await new Promise((r) => setTimeout(r, 2500));

  const witnessSpamCount = Array.from(witness.map.values()).filter((s) =>
    s.text?.startsWith("spam "),
  ).length;
  // 15/min cap means at most 15 should make it through; ideally far fewer
  // because the whole batch likely got rejected when count exceeded the cap.
  record(
    "authz-vuln-05 server-side write rate",
    witnessSpamCount <= 15,
    `witness saw ${witnessSpamCount} of 30 spam stickies (cap 15/min)`,
  );
  attacker.provider.destroy();
  witness.provider.destroy();
}

async function test_legit_user_can_still_write() {
  const room = ROOM + "-legit";
  const witness = makeProvider(room, { identity: encodeIdentity(WITNESS) });
  await waitConnected(witness.provider);
  await new Promise((r) => setTimeout(r, 300));

  const writer = makeProvider(room, { identity: encodeIdentity(ATTACKER) });
  await waitConnected(writer.provider);
  await new Promise((r) => setTimeout(r, 300));

  const noteId = "legit" + Date.now();
  writer.map.set(noteId, {
    id: noteId,
    x: 0,
    y: 0,
    text: "hello from legit user",
    color: ATTACKER.color,
    authorId: ATTACKER.id, // matches identity — legit
    authorName: ATTACKER.name,
    ts: Date.now(),
  });

  await new Promise((r) => setTimeout(r, 1500));

  const inWitness = !!witness.map.get(noteId);
  record(
    "regression — legit write still works",
    inWitness,
    inWitness ? "witness received it" : "witness did NOT see legit write (regression!)",
  );
  writer.provider.destroy();
  witness.provider.destroy();
}

// ─── Run ──────────────────────────────────────────────────────────────────

console.log(`security regression against ${HOST}`);
console.log(`room prefix: ${ROOM}`);
console.log("");

try {
  await test_no_identity_rejected();
  await test_create_other_user_sticky_rejected();
  await test_create_xss_color_rejected();
  await test_delete_other_user_sticky_rejected();
  await test_sensitive_word_rejected_server_side();
  await test_rate_limit_server_side();
  await test_legit_user_can_still_write();
} catch (err) {
  console.error("runner crashed:", err);
}

console.log("");
const failed = results.filter((r) => !r.passed);
if (failed.length === 0) {
  console.log(`✅ ALL ${results.length} REGRESSIONS PASSED`);
  process.exit(0);
} else {
  console.log(`❌ ${failed.length} / ${results.length} REGRESSIONS FAILED`);
  for (const f of failed) console.log("  •", f.name, "—", f.detail);
  process.exit(1);
}

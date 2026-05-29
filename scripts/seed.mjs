// Seed each channel with starter sticky notes so first-time visitors see
// content instead of an empty canvas.
//
// Usage:
//   node scripts/seed.mjs                                           # local
//   PARTY_HOST=greatfish-sync.example.com node scripts/seed.mjs     # prod
//
// Idempotent: re-runs overwrite the same nanoids.

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { WebSocket as WsBase } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:1999";
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;
if (agent) console.error(`[seed] tunneling WS via ${PROXY}`);

class WebSocket extends WsBase {
  constructor(url, protocols, options) {
    super(url, protocols, { ...options, agent });
  }
}

const SEED_AUTHOR = {
  id: "seedbot1234",
  name: "GreatFish 站长",
  color: "#f59e0b",
};

function encodeIdentity(identity) {
  const json = JSON.stringify(identity);
  return Buffer.from(json, "utf8").toString("base64");
}

const SEEDS = {
  "work-tea": [
    "听说 R2 的张总下季度要被换掉,有人有内幕吗?",
    "公司年会奖品又是充电宝……第 4 年了",
    "实习生第一天就接了 P0,带教真敢甩活",
    "OKR 写满 10 条,但只有 2 条是真的会做",
    "Q3 销售明细这张表其实从来没人填过",
  ],
  "star-tea": [
    "X 综艺 4 番出场顺序又被改了",
    "Y 工作室在三亚租的房子续约了,看来不准备结束恋情",
    "Z 路透里那身衣服跟去年某 ins 博主的撞了,绷不住",
    "明天会有大瓜,蹲一个",
  ],
  "love-tea": [
    "异地三年,昨天他说要分手,理由是『没感觉了』",
    "相亲第一次见面就被问月薪,我说了对方就走了",
    "前任结婚了我居然莫名其妙哭了",
    "今天有个人对我笑了一下,我已经在想我们小孩叫什么名字",
  ],
};

const grid = (idx) => {
  const cols = 3;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  return { x: 40 + col * 220, y: 80 + row * 140 };
};

async function seedRoom(slug, lines, adminToken) {
  const doc = new Y.Doc();
  const params = { identity: encodeIdentity(SEED_AUTHOR) };
  if (adminToken) params.admin = adminToken;
  const provider = new YPartyKitProvider(HOST, slug, doc, {
    party: "main",
    WebSocketPolyfill: WebSocket,
    params,
  });
  const stickies = doc.getMap("stickies");

  await new Promise((res) => {
    if (provider.wsconnected) return res();
    const onStatus = (e) => {
      if (e.status === "connected") {
        provider.off("status", onStatus);
        res();
      }
    };
    provider.on("status", onStatus);
  });

  await new Promise((r) => setTimeout(r, 500));

  lines.forEach((text, i) => {
    const id = `seed${slug.replace(/-/g, "")}${i}`;
    const pos = grid(i);
    stickies.set(id, {
      id,
      x: pos.x,
      y: pos.y,
      text,
      color: SEED_AUTHOR.color,
      authorId: SEED_AUTHOR.id,
      authorName: SEED_AUTHOR.name,
      ts: Date.now(),
    });
  });

  await new Promise((r) => setTimeout(r, 1200));
  provider.destroy();
  console.log(`✅ seeded #${slug} with ${lines.length} stickies`);
}

const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  console.warn(
    "[seed] no ADMIN_TOKEN — seeds will be created as 'seed-bot' identity. " +
      "If you re-run later from a different machine, the same identity " +
      "is required to overwrite them.",
  );
}

console.log(`seeding via ${HOST}…`);

for (const [slug, lines] of Object.entries(SEEDS)) {
  await seedRoom(slug, lines, adminToken);
}

console.log("done");
process.exit(0);

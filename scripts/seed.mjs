// Seed each channel with starter sticky notes so first-time visitors see
// content instead of an empty canvas.
//
// Usage:
//   node scripts/seed.mjs                 # seed against localhost:1999
//   PARTY_HOST=greatfish-sync.example.com node scripts/seed.mjs   # production
//
// Safe to re-run: writes the same nanoids so re-runs idempotently overwrite.

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { WebSocket as WsBase } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { nanoid } from "nanoid";

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
  id: "seed-bot",
  name: "GreatFish 站长",
  color: "#f59e0b",
};

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

const grid = (n, idx) => {
  const cols = 3;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  return { x: 40 + col * 220, y: 80 + row * 140 };
};

async function seedRoom(slug, lines) {
  const doc = new Y.Doc();
  const provider = new YPartyKitProvider(HOST, slug, doc, {
    party: "main",
    WebSocketPolyfill: WebSocket,
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

  // Brief wait so the initial sync (`syncStep1`) round-trips before we write,
  // otherwise our writes can race against the server's persisted state being
  // delivered to us.
  await new Promise((r) => setTimeout(r, 500));

  lines.forEach((text, i) => {
    const id = `seed-${slug}-${i}`;
    const pos = grid(lines.length, i);
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

  // Let the provider flush updates to the server before we tear down.
  await new Promise((r) => setTimeout(r, 600));
  provider.destroy();
  console.log(`✅ seeded #${slug} with ${lines.length} stickies`);
}

console.log(`seeding via ${HOST}…`);

for (const [slug, lines] of Object.entries(SEEDS)) {
  await seedRoom(slug, lines);
}

// nanoid is imported for future randomized seeding — keep the import alive.
void nanoid;

console.log("done");
process.exit(0);

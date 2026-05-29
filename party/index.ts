import type * as Party from "partykit/server";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import Mint from "mint-filter";

/**
 * GreatFish sync server — v2 (security-hardened).
 *
 * Replaces the y-partykit `onConnect` passthrough with our own Yjs sync
 * protocol handler so we can validate every incoming update against the
 * connection's identity. All authorization happens here on the server; the
 * client UI is purely cosmetic.
 *
 * Connection contract:
 *   wss://host/parties/main/<channel>?identity=<base64(json{id,name,color})>&admin=<token?>
 *
 * Rules enforced:
 *   - identity is required, well-formed, and bound to the connection
 *   - admin token (if present) must match env.ADMIN_TOKEN exactly
 *   - sticky.color must match a small hex whitelist
 *   - create: sticky.authorId must equal connection.identity.id (admin can spoof)
 *   - update: existing sticky's authorId must equal identity (admin can override)
 *            and authorId cannot be rewritten by anyone
 *   - delete: same as update
 *   - text is scanned by mint-filter; banned content rejects the whole update
 *   - per-connection write rate: 15 mutating ops / minute
 *   - per-IP connection rate: 20 / minute / room (kept from v1)
 */

const SYNC_MSG = 0;
const AWARENESS_MSG = 1;

const PERSIST_KEY = "yjs-state-v1";

// Same blocklist as src/filter.ts. Server-side enforcement.
const SENSITIVE_WORDS = [
  "加微信",
  "加 v",
  "加v",
  "代刷",
  "代练",
  "出售账号",
  "高薪兼职",
  "返利",
  "包赔",
  "色情",
  "约炮",
  "做爱",
  "黄片",
  "av下载",
  "法轮功",
  "六四",
];

const mint = new Mint(SENSITIVE_WORDS);

// Hex color whitelist. Rejects anything with parens / quotes / spaces /
// anything that could ever resolve to `url(...)`. Length cap covers
// short-form #fff and full #rrggbbaa.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function isValidColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 9 && HEX_COLOR_RE.test(value);
}

type StickyShape = "sticky" | "rect" | "circle";

type StickyNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  authorId: string;
  authorName: string;
  ts: number;
  // v2 customization fields — all optional, render defaults supplied client-side
  w?: number;
  h?: number;
  fontSize?: number;
  shape?: StickyShape;
  // v3 social fields
  z?: number;                                    // bring-to-front / send-to-back
  parentId?: string;                             // reply threading
  reactions?: Record<string, string[]>;          // emoji -> identityIds
};

const VALID_SHAPES: ReadonlySet<string> = new Set(["sticky", "rect", "circle"]);

const VALID_REACTIONS: ReadonlySet<string> = new Set([
  "👍",
  "❤️",
  "😂",
  "😢",
  "🍉",
  "🔥",
]);
const MAX_REACTORS_PER_EMOJI = 5000;

type Identity = { id: string; name: string; color: string };

type ConnState = {
  identity: Identity;
  isAdmin: boolean;
  writes: number[];
};

type Env = { ADMIN_TOKEN?: string };

function isStickyShape(s: unknown): s is StickyNote {
  if (!s || typeof s !== "object") return false;
  const n = s as Partial<StickyNote>;
  const baseOk =
    typeof n.id === "string" && n.id.length > 0 && n.id.length <= 32 &&
    typeof n.x === "number" && Number.isFinite(n.x) && Math.abs(n.x) < 100_000 &&
    typeof n.y === "number" && Number.isFinite(n.y) && Math.abs(n.y) < 100_000 &&
    typeof n.text === "string" && n.text.length <= 512 &&
    typeof n.color === "string" && n.color.length <= 16 &&
    typeof n.authorId === "string" && n.authorId.length > 0 && n.authorId.length <= 32 &&
    typeof n.authorName === "string" && n.authorName.length > 0 && n.authorName.length <= 32 &&
    typeof n.ts === "number" && Number.isFinite(n.ts);
  if (!baseOk) return false;

  // Optional v2 fields — if present, must be in range. Caps prevent DoS via
  // huge widths/fonts and prevent storing arbitrary opaque enums for shape.
  if (n.w !== undefined) {
    if (typeof n.w !== "number" || !Number.isFinite(n.w) || n.w < 60 || n.w > 800) return false;
  }
  if (n.h !== undefined) {
    if (typeof n.h !== "number" || !Number.isFinite(n.h) || n.h < 40 || n.h > 800) return false;
  }
  if (n.fontSize !== undefined) {
    if (typeof n.fontSize !== "number" || !Number.isFinite(n.fontSize) || n.fontSize < 10 || n.fontSize > 48) return false;
  }
  if (n.shape !== undefined) {
    if (typeof n.shape !== "string" || !VALID_SHAPES.has(n.shape)) return false;
  }
  if (n.z !== undefined) {
    if (typeof n.z !== "number" || !Number.isFinite(n.z) || Math.abs(n.z) > 1_000_000) return false;
  }
  if (n.parentId !== undefined) {
    if (typeof n.parentId !== "string" || n.parentId.length < 1 || n.parentId.length > 32) return false;
  }
  if (n.reactions !== undefined) {
    if (!n.reactions || typeof n.reactions !== "object" || Array.isArray(n.reactions)) return false;
    const keys = Object.keys(n.reactions);
    if (keys.length > VALID_REACTIONS.size) return false;
    for (const k of keys) {
      if (!VALID_REACTIONS.has(k)) return false;
      const v = (n.reactions as Record<string, unknown>)[k];
      if (!Array.isArray(v)) return false;
      if (v.length > MAX_REACTORS_PER_EMOJI) return false;
      for (const id of v) {
        if (typeof id !== "string" || id.length < 4 || id.length > 32) return false;
      }
    }
  }
  return true;
}

/**
 * For an update on an existing sticky, compute which non-reactions fields
 * changed (we treat `reactions` and `ts` specially). Used to allow third
 * parties to react without satisfying ownership checks.
 */
function nonReactionFieldsChanged(before: StickyNote, after: StickyNote): boolean {
  const skip = new Set(["reactions", "ts"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    const b = (before as Record<string, unknown>)[k];
    const a = (after as Record<string, unknown>)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) return true;
  }
  return false;
}

/**
 * Validate a reactions delta: anyone may add or remove THEIR OWN identity
 * id from a sticky's reactions; nobody may touch another user's id.
 * Returns a violation reason string, or null if allowed.
 */
function validateReactionsDelta(
  before: StickyNote,
  after: StickyNote,
  state: ConnState,
): string | null {
  if (state.isAdmin) return null;
  const myId = state.identity.id;
  const beforeR = before.reactions ?? {};
  const afterR = after.reactions ?? {};
  const emojis = new Set([...Object.keys(beforeR), ...Object.keys(afterR)]);
  for (const emoji of emojis) {
    if (!VALID_REACTIONS.has(emoji)) return `react-bad-emoji(${emoji.slice(0, 8)})`;
    const b = new Set(beforeR[emoji] ?? []);
    const a = new Set(afterR[emoji] ?? []);
    const added: string[] = [];
    const removed: string[] = [];
    for (const id of a) if (!b.has(id)) added.push(id);
    for (const id of b) if (!a.has(id)) removed.push(id);
    if (added.length > 1 || removed.length > 1) {
      return `react-multi(${emoji} +${added.length}/-${removed.length})`;
    }
    if (added.length === 1 && added[0] !== myId) {
      return `react-add-other(${emoji})`;
    }
    if (removed.length === 1 && removed[0] !== myId) {
      return `react-remove-other(${emoji})`;
    }
  }
  return null;
}

function textIsClean(text: string): boolean {
  if (!text) return true;
  // mint.verify returns true when text is clean, false when it hits a word.
  return mint.verify(text) === true;
}

export default class GreatFishParty implements Party.Server {
  private doc!: Y.Doc;
  private awareness!: awarenessProtocol.Awareness;
  private ready: Promise<void>;
  private ipConnects = new Map<string, number[]>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {
    this.ready = this.bootstrap();
  }

  private async bootstrap() {
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // Hydrate from storage if present.
    const stored = await this.room.storage.get<Uint8Array>(PERSIST_KEY);
    if (stored) {
      Y.applyUpdate(this.doc, stored);
    }

    this.doc.on("update", () => this.schedulePersist());
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null;
      try {
        const state = Y.encodeStateAsUpdate(this.doc);
        await this.room.storage.put(PERSIST_KEY, state);
      } catch (err) {
        console.error(`[${this.room.id}] persist failed`, err);
      }
    }, 1000);
  }

  private getIp(ctx: Party.ConnectionContext): string {
    return (
      ctx.request.headers.get("cf-connecting-ip") ??
      ctx.request.headers.get("x-forwarded-for") ??
      "unknown"
    );
  }

  private shouldIpRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const max = 20;
    const arr = this.ipConnects.get(ip) ?? [];
    const recent = arr.filter((t) => now - t < windowMs);
    recent.push(now);
    this.ipConnects.set(ip, recent);
    return recent.length > max;
  }

  private parseIdentity(raw: string | null): Identity | null {
    if (!raw) return null;
    try {
      const decoded = JSON.parse(atob(raw)) as Partial<Identity>;
      if (
        !decoded ||
        typeof decoded.id !== "string" || decoded.id.length < 4 || decoded.id.length > 32 ||
        typeof decoded.name !== "string" || decoded.name.length < 1 || decoded.name.length > 32 ||
        typeof decoded.color !== "string" || !isValidColor(decoded.color)
      ) {
        return null;
      }
      return { id: decoded.id, name: decoded.name, color: decoded.color };
    } catch {
      return null;
    }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    await this.ready;

    const ip = this.getIp(ctx);
    if (this.shouldIpRateLimit(ip)) {
      console.warn(`[${this.room.id}] ip-rate-limited ${ip}`);
      conn.close(4429, "rate limited");
      return;
    }

    const url = new URL(ctx.request.url);
    const identity = this.parseIdentity(url.searchParams.get("identity"));
    if (!identity) {
      conn.close(4001, "identity required");
      return;
    }

    const adminToken = url.searchParams.get("admin");
    const env = (this.room.env as Env) ?? {};
    const adminTokenSupplied = !!adminToken && adminToken.length > 0;
    const isAdmin =
      adminTokenSupplied && !!env.ADMIN_TOKEN && adminToken === env.ADMIN_TOKEN;

    // If the caller explicitly tried to authenticate as admin but the token
    // is wrong, refuse the connection so the client sees a real signal
    // instead of silently downgrading to a non-admin session. Close code
    // 4003 = "admin token rejected" (client uses it to clear the bad token
    // from localStorage and show the login form again).
    if (adminTokenSupplied && !isAdmin) {
      console.warn(`[${this.room.id}] bad admin token from ip=${ip} id=${identity.id}`);
      conn.close(4003, "bad admin token");
      return;
    }

    conn.setState({ identity, isAdmin, writes: [] });
    console.log(
      `[${this.room.id}] connect ip=${ip} id=${identity.id} admin=${isAdmin}`,
    );

    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SYNC_MSG);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    conn.send(encoding.toUint8Array(encoder));

    // Send awareness snapshot
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const aware = encoding.createEncoder();
      encoding.writeVarUint(aware, AWARENESS_MSG);
      encoding.writeVarUint8Array(
        aware,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      conn.send(encoding.toUint8Array(aware));
    }
  }

  async onMessage(
    message: ArrayBuffer | string,
    sender: Party.Connection,
  ) {
    const state = sender.state as ConnState | undefined;
    if (!state) {
      sender.close(4001, "no state");
      return;
    }

    if (typeof message === "string") {
      // We use binary protocol; silently drop string frames.
      return;
    }

    const bytes = new Uint8Array(message);
    const decoder = decoding.createDecoder(bytes);

    let messageType: number;
    try {
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === SYNC_MSG) {
      await this.handleSyncMessage(decoder, sender);
      return;
    }

    if (messageType === AWARENESS_MSG) {
      this.handleAwarenessMessage(decoder, sender);
      return;
    }
  }

  private async handleSyncMessage(
    decoder: decoding.Decoder,
    sender: Party.Connection,
  ) {
    let syncType: number;
    try {
      syncType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (syncType === 0) {
      // syncStep1 from client — respond with syncStep2
      const stateVector = decoding.readVarUint8Array(decoder);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SYNC_MSG);
      syncProtocol.writeSyncStep2(encoder, this.doc, stateVector);
      sender.send(encoding.toUint8Array(encoder));
      return;
    }

    if (syncType !== 1 && syncType !== 2) {
      return;
    }

    // syncStep2 (initial state diff) or update — validate before applying
    let update: Uint8Array;
    try {
      update = decoding.readVarUint8Array(decoder);
    } catch {
      return;
    }

    const state = sender.state as ConnState | undefined;
    if (!state) return;
    const { violations, newWrites } = this.validateUpdate(update, state);
    if (violations.length > 0) {
      console.warn(
        `[${this.room.id}] rejected update from ${state.identity.id}: ${violations.join(", ")}`,
      );
      // Force the offending client back to canonical state.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SYNC_MSG);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      sender.send(encoding.toUint8Array(encoder));
      return;
    }

    // Update connection's write-rate accounting
    if (newWrites !== state.writes) {
      sender.setState({ ...state, writes: newWrites });
    }

    // Apply locally
    Y.applyUpdate(this.doc, update, sender);

    // Broadcast as update message to all OTHER connections
    const out = encoding.createEncoder();
    encoding.writeVarUint(out, SYNC_MSG);
    syncProtocol.writeUpdate(out, update);
    const payload = encoding.toUint8Array(out);
    this.room.broadcast(payload, [sender.id]);
  }

  private handleAwarenessMessage(
    decoder: decoding.Decoder,
    sender: Party.Connection,
  ) {
    let update: Uint8Array;
    try {
      update = decoding.readVarUint8Array(decoder);
    } catch {
      return;
    }
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, sender);

    const out = encoding.createEncoder();
    encoding.writeVarUint(out, AWARENESS_MSG);
    encoding.writeVarUint8Array(out, update);
    const payload = encoding.toUint8Array(out);
    this.room.broadcast(payload, [sender.id]);
  }

  /**
   * Validate by applying the update to a shadow copy and diffing the
   * stickies map. Returns violation reasons (empty = approved) plus the
   * updated per-connection write timestamps for rate limiting.
   */
  private validateUpdate(
    update: Uint8Array,
    state: ConnState,
  ): { violations: string[]; newWrites: number[] } {
    const violations: string[] = [];
    let newWrites = state.writes;

    let shadow: Y.Doc;
    try {
      shadow = new Y.Doc({ gc: true });
      Y.applyUpdate(shadow, Y.encodeStateAsUpdate(this.doc));
      Y.applyUpdate(shadow, update);
    } catch (err) {
      return {
        violations: [`bad-update: ${(err as Error).message}`],
        newWrites: state.writes,
      };
    }

    const current = this.doc.getMap<StickyNote>("stickies");
    const after = shadow.getMap<StickyNote>("stickies");

    const allKeys = new Set<string>([...current.keys(), ...after.keys()]);

    let mutationCount = 0;

    for (const key of allKeys) {
      const before = current.get(key);
      const next = after.get(key);

      // No change to this key
      if (before && next && JSON.stringify(before) === JSON.stringify(next)) {
        continue;
      }

      mutationCount++;

      // Deletion
      if (before && !next) {
        if (!state.isAdmin && before.authorId !== state.identity.id) {
          violations.push(`delete-other(${key})`);
        }
        continue;
      }

      // Creation
      if (!before && next) {
        if (!isStickyShape(next)) {
          violations.push(`create-malformed(${key})`);
          continue;
        }
        if (next.id !== key) {
          violations.push(`create-key-mismatch(${key} vs ${next.id})`);
          continue;
        }
        if (!isValidColor(next.color)) {
          violations.push(`create-bad-color(${key})`);
        }
        if (!state.isAdmin && next.authorId !== state.identity.id) {
          violations.push(`create-spoofed-author(${key})`);
        }
        if (!textIsClean(next.text)) {
          violations.push(`create-blocked-text(${key})`);
        }
        // On creation, reactions must be either absent/empty, or contain
        // ONLY the creator's own identity id under any emoji. Prevents
        // seeding a new sticky with fake reactions from other users.
        if (next.reactions) {
          for (const [emoji, ids] of Object.entries(next.reactions)) {
            if (!Array.isArray(ids)) continue;
            for (const id of ids) {
              if (!state.isAdmin && id !== state.identity.id) {
                violations.push(`create-react-spoof(${key},${emoji})`);
              }
            }
          }
        }
        continue;
      }

      // Update
      if (before && next) {
        if (!isStickyShape(next)) {
          violations.push(`update-malformed(${key})`);
          continue;
        }
        if (next.id !== key) {
          violations.push(`update-key-mismatch(${key})`);
          continue;
        }
        if (next.authorId !== before.authorId) {
          violations.push(`update-rewrites-author(${key})`);
        }

        // Ownership only applies to non-reaction fields. Reactions have
        // their own per-emoji "add-or-remove only your own id" rule so
        // any user can react to any sticky.
        const nonReactChanged = nonReactionFieldsChanged(before, next);
        if (nonReactChanged && !state.isAdmin && before.authorId !== state.identity.id) {
          violations.push(`update-other(${key})`);
        }

        const reactViolation = validateReactionsDelta(before, next, state);
        if (reactViolation) violations.push(`${reactViolation}(${key})`);

        // Color / text only need re-validation when they changed.
        if (next.color !== before.color && !isValidColor(next.color)) {
          violations.push(`update-bad-color(${key})`);
        }
        if (next.text !== before.text && !textIsClean(next.text)) {
          violations.push(`update-blocked-text(${key})`);
        }
        continue;
      }
    }

    if (mutationCount > 0) {
      const now = Date.now();
      const recent = state.writes.filter((t) => now - t < 60_000);
      for (let i = 0; i < mutationCount; i++) recent.push(now);
      const max = state.isAdmin ? 200 : 15;
      if (recent.length > max) {
        violations.push(`conn-write-rate(${recent.length}/${max})`);
      }
      newWrites = recent;
    }

    // Anything outside the stickies map is forbidden — keeps the schema
    // small and avoids surprise data structures being smuggled in.
    for (const name of shadow.share.keys()) {
      if (name !== "stickies") {
        violations.push(`foreign-share(${name})`);
      }
    }

    return { violations, newWrites };
  }

  async onClose(_conn: Party.Connection) {
    // Awareness state is keyed by Y.Doc clientID, not PartyKit connection id,
    // so we can't directly remove it here without a mapping table. The
    // awareness protocol's built-in timeout will reap it on its own.
  }

  async onError(conn: Party.Connection, err: Error) {
    console.error(`[${this.room.id}] conn ${conn.id} error`, err);
  }
}

import { nanoid } from "nanoid";

export type Identity = {
  id: string;
  name: string;
  color: string;
};

const KEY = "greatfish.identity";

const animals = [
  "水獭",
  "柴犬",
  "狸花",
  "刺猬",
  "海豚",
  "树懒",
  "羊驼",
  "狐狸",
  "兔子",
  "浣熊",
  "鸭子",
  "章鱼",
];

const adjectives = [
  "紫色的",
  "鎏金的",
  "薄荷的",
  "海盐的",
  "落日的",
  "桃子的",
  "雾蓝的",
  "苔藓的",
  "焦糖的",
  "玫瑰的",
];

export const PALETTE = [
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#0ea5e9",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
] as const;

const PALETTE_SET = new Set<string>(PALETTE);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** Server-mirrored color check. Anything else gets rendered as a fallback. */
export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 9 && HEX_COLOR_RE.test(value);
}

/** Even stricter: only accept colors that came from our own palette. */
export function isPaletteColor(value: unknown): value is string {
  return typeof value === "string" && PALETTE_SET.has(value);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getIdentity(): Identity {
  const cached = localStorage.getItem(KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as Identity;
      if (
        parsed &&
        typeof parsed.id === "string" &&
        parsed.id.length >= 4 &&
        typeof parsed.name === "string" &&
        isPaletteColor(parsed.color)
      ) {
        return parsed;
      }
    } catch {
      // corrupted, regenerate
    }
  }
  const fresh: Identity = {
    id: nanoid(),
    name: pick(adjectives) + pick(animals),
    color: pick(PALETTE),
  };
  localStorage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

/** Base64-encode the identity for transmission as a WS query string param. */
export function encodeIdentityForWire(id: Identity): string {
  const json = JSON.stringify({ id: id.id, name: id.name, color: id.color });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

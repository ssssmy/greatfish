export type StickyShape = "sticky" | "rect" | "circle";

export type StickyNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  authorId: string;
  authorName: string;
  ts: number;
  // v2 customization (optional — defaults filled in at render time)
  w?: number;
  h?: number;
  fontSize?: number;
  shape?: StickyShape;
  // v3 social
  z?: number;
  parentId?: string;
  reactions?: Record<string, string[]>;
};

export const DEFAULT_W = 180;
export const DEFAULT_H = 100;
export const DEFAULT_FONT = 14;
export const DEFAULT_SHAPE: StickyShape = "sticky";

export const W_MIN = 80;
export const W_MAX = 400;
export const W_STEP = 20;
export const H_MIN = 60;
export const H_MAX = 400;
export const H_STEP = 20;

export const FONT_PRESETS: { label: string; px: number }[] = [
  { label: "S", px: 12 },
  { label: "M", px: 14 },
  { label: "L", px: 20 },
  { label: "XL", px: 28 },
];

export const SHAPE_PRESETS: { value: StickyShape; label: string; title: string }[] = [
  { value: "sticky", label: "▢", title: "便利贴(圆角)" },
  { value: "rect", label: "▭", title: "矩形(直角)" },
  { value: "circle", label: "◯", title: "圆形" },
];

export const EMOJIS_REACTION = ["👍", "❤️", "😂", "😢", "🍉", "🔥"] as const;
export type ReactionEmoji = (typeof EMOJIS_REACTION)[number];

export const EMOJIS_QUICK = [
  "😂", "🤣", "😭", "😱", "🙄", "😶",
  "🍉", "🔥", "💀", "🤡", "🐶", "🐱",
  "✨", "💩", "🚀", "🙏", "👀", "🤝",
];

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function getW(n: StickyNote): number {
  return clamp(n.w ?? DEFAULT_W, W_MIN, W_MAX);
}

export function getH(n: StickyNote): number {
  if ((n.shape ?? DEFAULT_SHAPE) === "circle") return getW(n);
  return clamp(n.h ?? DEFAULT_H, H_MIN, H_MAX);
}

export function getFontSize(n: StickyNote): number {
  return clamp(n.fontSize ?? DEFAULT_FONT, 10, 48);
}

export function getShape(n: StickyNote): StickyShape {
  const s = n.shape;
  return s === "sticky" || s === "rect" || s === "circle" ? s : DEFAULT_SHAPE;
}

export function getZ(n: StickyNote): number {
  return Number.isFinite(n.z) ? (n.z as number) : 0;
}

export function reactionCount(n: StickyNote): number {
  if (!n.reactions) return 0;
  let total = 0;
  for (const v of Object.values(n.reactions)) total += v.length;
  return total;
}

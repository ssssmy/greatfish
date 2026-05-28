import Mint from "mint-filter";

// A small starter blocklist. The point isn't completeness — the design says
// admin delete is the real backstop. This catches obvious spam and the worst
// offenders so honest users don't see them.
const WORDS = [
  // 广告 / 推广
  "加微信",
  "加 v",
  "加v",
  "代刷",
  "代练",
  "出售账号",
  "高薪兼职",
  "返利",
  "包赔",
  // 色情
  "色情",
  "约炮",
  "做爱",
  "黄片",
  "av下载",
  // 政治高敏(只放最最高频的,完整词库后期接更专业的)
  "法轮功",
  "六四",
];

const mint = new Mint(WORDS);

export type FilterResult = {
  ok: boolean;
  cleaned: string;
  hits: string[];
};

export function filterText(text: string): FilterResult {
  if (!text) return { ok: true, cleaned: text, hits: [] };
  const v = mint.verify(text);
  if (v) return { ok: true, cleaned: text, hits: [] };
  const f = mint.filter(text, { replace: true });
  return {
    ok: false,
    cleaned: typeof f === "string" ? f : f.text,
    hits: Array.isArray(f) ? f : (f as { words?: string[] }).words ?? [],
  };
}

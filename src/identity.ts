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

const palette = [
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#0ea5e9",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getIdentity(): Identity {
  const cached = localStorage.getItem(KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as Identity;
    } catch {
      // corrupted, regenerate
    }
  }
  const fresh: Identity = {
    id: nanoid(),
    name: pick(adjectives) + pick(animals),
    color: pick(palette),
  };
  localStorage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

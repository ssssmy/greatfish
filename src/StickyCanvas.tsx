import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { nanoid } from "nanoid";
import type { Identity } from "./identity";
import { encodeIdentityForWire, isValidHexColor, PALETTE } from "./identity";
import { filterText } from "./filter";

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
  // v2 customization (optional — old stickies render with defaults)
  w?: number;
  h?: number;
  fontSize?: number;
  shape?: StickyShape;
};

type Props = {
  channel: string;
  identity: Identity;
  partyHost: string;
  /** Admin token; if supplied and accepted by the server, admin gains
   *  delete/edit access to any sticky. */
  adminToken?: string;
};

type ConnState = "connecting" | "connected" | "disconnected";

const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60_000;
const FALLBACK_COLOR = "#888";

// Defaults match the server's accepted ranges (60-800, 40-800, 10-48).
const DEFAULT_W = 180;
const DEFAULT_H = 100;
const DEFAULT_FONT = 14;
const DEFAULT_SHAPE: StickyShape = "sticky";

const W_MIN = 80;
const W_MAX = 400;
const W_STEP = 20;
const H_MIN = 60;
const H_MAX = 400;
const H_STEP = 20;

const FONT_PRESETS: { label: string; px: number }[] = [
  { label: "S", px: 12 },
  { label: "M", px: 14 },
  { label: "L", px: 20 },
  { label: "XL", px: 28 },
];

const SHAPE_PRESETS: { value: StickyShape; label: string; title: string }[] = [
  { value: "sticky", label: "▢", title: "便利贴(圆角)" },
  { value: "rect", label: "▭", title: "矩形(直角)" },
  { value: "circle", label: "◯", title: "圆形" },
];

function safeRenderColor(value: unknown): string {
  return isValidHexColor(value) ? value : FALLBACK_COLOR;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function getW(n: StickyNote): number {
  return clamp(n.w ?? DEFAULT_W, W_MIN, W_MAX);
}
function getH(n: StickyNote): number {
  // Circle is rendered as a square; height should match width.
  if ((n.shape ?? DEFAULT_SHAPE) === "circle") return getW(n);
  return clamp(n.h ?? DEFAULT_H, H_MIN, H_MAX);
}
function getFontSize(n: StickyNote): number {
  return clamp(n.fontSize ?? DEFAULT_FONT, 10, 48);
}
function getShape(n: StickyNote): StickyShape {
  const s = n.shape;
  return s === "sticky" || s === "rect" || s === "circle" ? s : DEFAULT_SHAPE;
}

export function StickyCanvas({ channel, identity, partyHost, adminToken }: Props) {
  const stickiesRef = useRef<Y.Map<StickyNote> | null>(null);
  const [snapshot, setSnapshot] = useState<StickyNote[]>([]);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const createTimes = useRef<number[]>([]);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(partyHost, channel, doc, {
      party: "main",
      params: {
        identity: encodeIdentityForWire(identity),
        admin: adminToken ? adminToken : null,
      },
    });
    const stickies = doc.getMap<StickyNote>("stickies");
    stickiesRef.current = stickies;

    setConnState(provider.wsconnected ? "connected" : "connecting");

    const onStatus = (e: { status: ConnState }) => setConnState(e.status);
    provider.on("status", onStatus);

    const refresh = () => setSnapshot(Array.from(stickies.values()));
    stickies.observe(refresh);
    refresh();

    return () => {
      stickies.unobserve(refresh);
      provider.off("status", onStatus);
      provider.destroy();
      doc.destroy();
      stickiesRef.current = null;
    };
  }, [channel, partyHost, identity, adminToken]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  function canCreateNow(): boolean {
    const now = Date.now();
    createTimes.current = createTimes.current.filter((t) => now - t < CREATE_WINDOW_MS);
    if (createTimes.current.length >= CREATE_LIMIT) return false;
    createTimes.current.push(now);
    return true;
  }

  function addStickyAt(x: number, y: number) {
    const stickies = stickiesRef.current;
    if (!stickies) return;
    if (!canCreateNow()) {
      showToast(`慢一点,1 分钟最多 ${CREATE_LIMIT} 条`);
      return;
    }
    const color = PALETTE.includes(identity.color as (typeof PALETTE)[number])
      ? identity.color
      : PALETTE[0];
    const note: StickyNote = {
      id: nanoid(),
      x,
      y,
      text: "",
      color,
      authorId: identity.id,
      authorName: identity.name,
      ts: Date.now(),
      w: DEFAULT_W,
      h: DEFAULT_H,
      fontSize: DEFAULT_FONT,
      shape: DEFAULT_SHAPE,
    };
    stickies.set(note.id, note);
    setSelectedId(note.id);
  }

  function handleCanvasDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    addStickyAt(e.clientX - rect.left - DEFAULT_W / 2, e.clientY - rect.top - DEFAULT_H / 2);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === canvasRef.current) setSelectedId(null);
  }

  function updateSticky(id: string, patch: Partial<StickyNote>) {
    const stickies = stickiesRef.current;
    if (!stickies) return;
    const existing = stickies.get(id);
    if (!existing) return;

    if (typeof patch.text === "string") {
      const f = filterText(patch.text);
      if (!f.ok) {
        showToast(`敏感词被替换: ${f.hits.join(", ") || "已过滤"}`);
        patch = { ...patch, text: f.cleaned };
      }
    }

    // Never let the client mutate authorId / authorName — server would
    // reject, and we don't want optimistic local drift.
    const safePatch: Partial<StickyNote> = { ...patch };
    delete safePatch.authorId;
    delete safePatch.authorName;
    if (safePatch.color !== undefined && !isValidHexColor(safePatch.color)) {
      delete safePatch.color;
    }
    if (safePatch.w !== undefined) safePatch.w = clamp(safePatch.w, W_MIN, W_MAX);
    if (safePatch.h !== undefined) safePatch.h = clamp(safePatch.h, H_MIN, H_MAX);
    if (safePatch.fontSize !== undefined) safePatch.fontSize = clamp(safePatch.fontSize, 10, 48);
    if (safePatch.shape !== undefined) {
      const s = safePatch.shape;
      if (s !== "sticky" && s !== "rect" && s !== "circle") delete safePatch.shape;
    }

    stickies.set(id, { ...existing, ...safePatch, ts: Date.now() });
  }

  function deleteSticky(id: string) {
    stickiesRef.current?.delete(id);
    if (selectedId === id) setSelectedId(null);
  }

  const selected = useMemo(
    () => (selectedId ? snapshot.find((s) => s.id === selectedId) ?? null : null),
    [selectedId, snapshot],
  );

  return (
    <div className="stage">
      <header className="topbar">
        <div className="brand">
          GreatFish · #{channel}
          {adminToken && <span className="badge-admin">admin</span>}
        </div>
        <div className="meta">
          <span className="dot" style={{ background: safeRenderColor(identity.color) }} />
          <span>{identity.name}</span>
          <span className={`conn conn-${connState}`}>{connState}</span>
          <span className="hint">双击空白处新建 · 点击便利贴定制</span>
        </div>
      </header>
      <div
        ref={canvasRef}
        className="canvas"
        onDoubleClick={handleCanvasDoubleClick}
        onClick={handleCanvasClick}
      >
        {snapshot.map((s) => (
          <Sticky
            key={s.id}
            note={s}
            editable={!!adminToken || s.authorId === identity.id}
            canDelete={!!adminToken || s.authorId === identity.id}
            selected={s.id === selectedId}
            onSelect={() => {
              if (!!adminToken || s.authorId === identity.id) setSelectedId(s.id);
            }}
            onUpdate={(patch) => updateSticky(s.id, patch)}
            onDelete={() => deleteSticky(s.id)}
          />
        ))}
        {selected && (!!adminToken || selected.authorId === identity.id) && (
          <Toolbar
            note={selected}
            onUpdate={(patch) => updateSticky(selected.id, patch)}
            onDelete={() => deleteSticky(selected.id)}
          />
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Sticky({
  note,
  editable,
  canDelete,
  selected,
  onSelect,
  onUpdate,
  onDelete,
}: {
  note: StickyNote;
  editable: boolean;
  canDelete: boolean;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<StickyNote>) => void;
  onDelete: () => void;
}) {
  const dragState = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const shape = getShape(note);
  const w = getW(note);
  const h = getH(note);
  const fontSize = getFontSize(note);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    e.stopPropagation();
    if (!editable) {
      // Even non-editable lets you "select" to read author info; but no drag.
      onSelect();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: note.x,
      origY: note.y,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.abs(dx) + Math.abs(dy) > 4) s.moved = true;
    if (s.moved) onUpdate({ x: s.origX + dx, y: s.origY + dy });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (s) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragState.current = null;
      if (!s.moved) onSelect();
    }
  }

  const style: React.CSSProperties = {
    left: note.x,
    top: note.y,
    width: w,
    height: h,
    background: safeRenderColor(note.color),
    borderRadius: shape === "sticky" ? 6 : shape === "rect" ? 0 : "50%",
    fontSize: `${fontSize}px`,
  };

  const className =
    "sticky" +
    (shape === "circle" ? " sticky-circle" : "") +
    (selected ? " sticky-selected" : "");

  return (
    <div
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="sticky-author">{note.authorName}</div>
      <textarea
        value={note.text}
        placeholder="说点什么..."
        readOnly={!editable}
        onChange={(e) => onUpdate({ text: e.target.value })}
        style={{ fontSize: `${fontSize}px` }}
      />
      {canDelete && selected && (
        <button
          className="sticky-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="删除"
        >
          ×
        </button>
      )}
    </div>
  );
}

function Toolbar({
  note,
  onUpdate,
  onDelete,
}: {
  note: StickyNote;
  onUpdate: (patch: Partial<StickyNote>) => void;
  onDelete: () => void;
}) {
  const w = getW(note);
  const h = getH(note);
  const fontSize = getFontSize(note);
  const shape = getShape(note);

  // Toolbar floats above the sticky; clamp to stay inside the canvas
  // (assume top: 0 means just at canvas top; fine if it goes slightly off
  // for stickies near the top edge — better than overlapping the note).
  const top = Math.max(8, note.y - 56);

  function patchW(delta: number) {
    onUpdate({ w: clamp(w + delta, W_MIN, W_MAX) });
  }
  function patchH(delta: number) {
    if (shape === "circle") onUpdate({ w: clamp(w + delta, W_MIN, W_MAX) });
    else onUpdate({ h: clamp(h + delta, H_MIN, H_MAX) });
  }

  return (
    <div
      className="sticky-toolbar"
      style={{ left: note.x, top }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="tb-group" title="颜色">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={"tb-swatch" + (note.color === c ? " active" : "")}
            style={{ background: c }}
            onClick={() => onUpdate({ color: c })}
          />
        ))}
        <input
          className="tb-color-input"
          type="color"
          value={isValidHexColor(note.color) ? note.color : "#888888"}
          onChange={(e) => onUpdate({ color: e.target.value })}
          title="自定义颜色"
        />
      </div>

      <div className="tb-divider" />

      <div className="tb-group" title="尺寸">
        <span className="tb-label">W</span>
        <button className="tb-btn" onClick={() => patchW(-W_STEP)}>
          −
        </button>
        <span className="tb-num">{Math.round(w)}</span>
        <button className="tb-btn" onClick={() => patchW(W_STEP)}>
          +
        </button>
        <span className="tb-label">H</span>
        <button className="tb-btn" onClick={() => patchH(-H_STEP)}>
          −
        </button>
        <span className="tb-num">{Math.round(h)}</span>
        <button className="tb-btn" onClick={() => patchH(H_STEP)}>
          +
        </button>
      </div>

      <div className="tb-divider" />

      <div className="tb-group" title="字号">
        {FONT_PRESETS.map((f) => (
          <button
            key={f.px}
            className={"tb-font" + (fontSize === f.px ? " active" : "")}
            onClick={() => onUpdate({ fontSize: f.px })}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="tb-divider" />

      <div className="tb-group" title="形状">
        {SHAPE_PRESETS.map((s) => (
          <button
            key={s.value}
            className={"tb-shape" + (shape === s.value ? " active" : "")}
            onClick={() => onUpdate({ shape: s.value })}
            title={s.title}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="tb-divider" />

      <button className="tb-danger" onClick={onDelete} title="删除">
        删除
      </button>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { nanoid } from "nanoid";
import type { Identity } from "./identity";
import { encodeIdentityForWire, isValidHexColor, PALETTE } from "./identity";
import { filterText } from "./filter";
import {
  type StickyNote,
  type StickyShape,
  DEFAULT_W,
  DEFAULT_H,
  DEFAULT_FONT,
  DEFAULT_SHAPE,
  W_MIN,
  W_MAX,
  W_STEP,
  H_MIN,
  H_MAX,
  H_STEP,
  FONT_PRESETS,
  SHAPE_PRESETS,
  EMOJIS_REACTION,
  EMOJIS_QUICK,
  clamp,
  getW,
  getH,
  getFontSize,
  getShape,
  getZ,
  reactionCount,
} from "./sticky-types";

export type { StickyNote } from "./sticky-types";

type Props = {
  channel: string;
  identity: Identity;
  partyHost: string;
  adminToken?: string;
};

type ConnState = "connecting" | "connected" | "disconnected";
type SortMode = "new" | "hot";
type ViewMode = "canvas" | "feed";

type Viewport = { panX: number; panY: number; zoom: number };

type PresencePeer = {
  clientId: number;
  cursorX: number;
  cursorY: number;
  name: string;
  color: string;
};

const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60_000;
const FALLBACK_COLOR = "#888";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

function safeRenderColor(value: unknown): string {
  return isValidHexColor(value) ? value : FALLBACK_COLOR;
}

export function StickyCanvas({ channel, identity, partyHost, adminToken }: Props) {
  const stickiesRef = useRef<Y.Map<StickyNote> | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const [snapshot, setSnapshot] = useState<StickyNote[]>([]);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresencePeer[]>([]);

  const [viewport, setViewport] = useState<Viewport>({ panX: 0, panY: 0, zoom: 1 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("canvas");
  const [sortMode, setSortMode] = useState<SortMode>("new");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const createTimes = useRef<number[]>([]);
  const panStart = useRef<{ sx: number; sy: number; pan: Viewport } | null>(null);

  // ─── connect ────────────────────────────────────────────────────────────
  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(partyHost, channel, doc, {
      party: "main",
      params: {
        identity: encodeIdentityForWire(identity),
        admin: adminToken ? adminToken : null,
      },
    });
    providerRef.current = provider;
    const stickies = doc.getMap<StickyNote>("stickies");
    stickiesRef.current = stickies;

    setConnState(provider.wsconnected ? "connected" : "connecting");

    const onStatus = (e: { status: ConnState }) => setConnState(e.status);
    provider.on("status", onStatus);

    const refresh = () => setSnapshot(Array.from(stickies.values()));
    stickies.observe(refresh);
    refresh();

    // Awareness — presence + cursor
    provider.awareness.setLocalStateField("identity", {
      name: identity.name,
      color: identity.color,
    });
    const refreshPresence = () => {
      const peers: PresencePeer[] = [];
      provider.awareness.getStates().forEach((s, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        const ident = (s as { identity?: { name: string; color: string } }).identity;
        const cur = (s as { cursor?: { x: number; y: number } }).cursor;
        if (!ident || !cur) return;
        peers.push({
          clientId,
          cursorX: cur.x,
          cursorY: cur.y,
          name: ident.name,
          color: ident.color,
        });
      });
      setPresence(peers);
    };
    provider.awareness.on("change", refreshPresence);
    refreshPresence();

    return () => {
      stickies.unobserve(refresh);
      provider.off("status", onStatus);
      provider.awareness.off("change", refreshPresence);
      provider.destroy();
      doc.destroy();
      stickiesRef.current = null;
      providerRef.current = null;
    };
  }, [channel, partyHost, identity, adminToken]);

  // ─── permalink → scroll + highlight ────────────────────────────────────
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!hash) return;
    const tries = [0, 200, 600, 1200];
    tries.forEach((delay) =>
      setTimeout(() => {
        const note = snapshot.find((s) => s.id === hash);
        if (!note) return;
        setHighlightedId(hash);
        // Center viewport on it
        const el = canvasRef.current;
        if (el) {
          const w = getW(note);
          const h = getH(note);
          const rect = el.getBoundingClientRect();
          setViewport({
            zoom: 1,
            panX: rect.width / 2 - (note.x + w / 2),
            panY: rect.height / 2 - (note.y + h / 2),
          });
        }
        setTimeout(() => setHighlightedId(null), 2400);
      }, delay),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── helpers ───────────────────────────────────────────────────────────
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

  /** Convert a screen-space mouse coordinate (e.client*) to world-space. */
  function screenToWorld(sx: number, sy: number) {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const v = viewportRef.current;
    return {
      x: (sx - rect.left - v.panX) / v.zoom,
      y: (sy - rect.top - v.panY) / v.zoom,
    };
  }

  function maxZ(): number {
    let z = 0;
    for (const s of snapshot) z = Math.max(z, getZ(s));
    return z;
  }
  function minZ(): number {
    let z = 0;
    for (const s of snapshot) z = Math.min(z, getZ(s));
    return z;
  }

  function addStickyAt(worldX: number, worldY: number, parentId?: string) {
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
      x: worldX,
      y: worldY,
      text: "",
      color,
      authorId: identity.id,
      authorName: identity.name,
      ts: Date.now(),
      w: DEFAULT_W,
      h: DEFAULT_H,
      fontSize: DEFAULT_FONT,
      shape: DEFAULT_SHAPE,
      z: maxZ() + 1,
    };
    if (parentId) note.parentId = parentId;
    stickies.set(note.id, note);
    setSelectedId(note.id);
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

  function toggleReaction(id: string, emoji: string) {
    const stickies = stickiesRef.current;
    if (!stickies) return;
    const existing = stickies.get(id);
    if (!existing) return;
    const reactions = { ...(existing.reactions ?? {}) };
    const arr = (reactions[emoji] ?? []).slice();
    const idx = arr.indexOf(identity.id);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(identity.id);
    if (arr.length === 0) delete reactions[emoji];
    else reactions[emoji] = arr;
    stickies.set(id, { ...existing, reactions, ts: Date.now() });
  }

  function deleteSticky(id: string) {
    stickiesRef.current?.delete(id);
    if (selectedId === id) setSelectedId(null);
  }

  function bringToFront(id: string) {
    updateSticky(id, { z: maxZ() + 1 });
  }
  function sendToBack(id: string) {
    updateSticky(id, { z: minZ() - 1 });
  }

  function replyTo(id: string) {
    const stickies = stickiesRef.current;
    if (!stickies) return;
    const parent = stickies.get(id);
    if (!parent) return;
    const pW = getW(parent);
    const pH = getH(parent);
    addStickyAt(parent.x + pW + 24, parent.y + pH / 2 - DEFAULT_H / 2, id);
  }

  function copyPermalink(id: string) {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    navigator.clipboard?.writeText(url).then(
      () => showToast("链接已复制"),
      () => showToast("复制失败,手动 URL 加 #" + id.slice(0, 8) + "..."),
    );
  }

  // ─── canvas event handlers ─────────────────────────────────────────────
  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== canvasRef.current) return;
    // Middle button, or Alt-drag, or Space-drag → pan
    if (e.button === 1 || e.altKey) {
      e.preventDefault();
      panStart.current = { sx: e.clientX, sy: e.clientY, pan: viewportRef.current };
      canvasRef.current?.setPointerCapture(e.pointerId);
    }
  }

  function handleCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (panStart.current) {
      const dx = e.clientX - panStart.current.sx;
      const dy = e.clientY - panStart.current.sy;
      setViewport({
        zoom: panStart.current.pan.zoom,
        panX: panStart.current.pan.panX + dx,
        panY: panStart.current.pan.panY + dy,
      });
      return;
    }
    // Awareness — broadcast cursor in world coords
    const prov = providerRef.current;
    if (prov) {
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      prov.awareness.setLocalStateField("cursor", { x, y });
    }
  }

  function handleCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (panStart.current) {
      panStart.current = null;
      canvasRef.current?.releasePointerCapture(e.pointerId);
    }
  }

  function handleCanvasDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== canvasRef.current) return;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    addStickyAt(x - DEFAULT_W / 2, y - DEFAULT_H / 2);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === canvasRef.current) setSelectedId(null);
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const v = viewportRef.current;
    const delta = -e.deltaY * 0.001;
    const newZoom = clamp(v.zoom * (1 + delta), ZOOM_MIN, ZOOM_MAX);
    if (newZoom === v.zoom) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldX = (sx - v.panX) / v.zoom;
    const worldY = (sy - v.panY) / v.zoom;
    setViewport({
      zoom: newZoom,
      panX: sx - worldX * newZoom,
      panY: sy - worldY * newZoom,
    });
  }

  function resetViewport() {
    setViewport({ panX: 0, panY: 0, zoom: 1 });
  }

  // ─── derived data ──────────────────────────────────────────────────────
  const selected = useMemo(
    () => (selectedId ? snapshot.find((s) => s.id === selectedId) ?? null : null),
    [selectedId, snapshot],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return snapshot;
    return snapshot.filter(
      (s) =>
        (s.text ?? "").toLowerCase().includes(q) ||
        (s.authorName ?? "").toLowerCase().includes(q),
    );
  }, [snapshot, search]);

  const sortedForFeed = useMemo(() => {
    const arr = filtered.slice();
    if (sortMode === "new") arr.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    else arr.sort((a, b) => reactionCount(b) - reactionCount(a) || (b.ts ?? 0) - (a.ts ?? 0));
    return arr;
  }, [filtered, sortMode]);

  // For canvas: filtered set + sticky maps for parent lookups
  const filteredSet = useMemo(() => new Set(filtered.map((s) => s.id)), [filtered]);
  const byId = useMemo(() => {
    const m = new Map<string, StickyNote>();
    for (const s of snapshot) m.set(s.id, s);
    return m;
  }, [snapshot]);

  // Sticky -> array of children (replies)
  const repliesByParent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of snapshot) {
      if (s.parentId) {
        const list = m.get(s.parentId) ?? [];
        list.push(s.id);
        m.set(s.parentId, list);
      }
    }
    return m;
  }, [snapshot]);

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
          <span className="online-count" title="在线人数">
            {presence.length + 1} 人在线
          </span>
        </div>
      </header>

      <div className="subtopbar">
        <div className="view-switch">
          <button
            className={view === "canvas" ? "active" : ""}
            onClick={() => setView("canvas")}
          >
            画布
          </button>
          <button className={view === "feed" ? "active" : ""} onClick={() => setView("feed")}>
            列表
          </button>
        </div>
        <input
          className="search-input"
          placeholder="搜文字或昵称…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="sort-switch">
          <button
            className={sortMode === "new" ? "active" : ""}
            onClick={() => setSortMode("new")}
          >
            最新
          </button>
          <button
            className={sortMode === "hot" ? "active" : ""}
            onClick={() => setSortMode("hot")}
          >
            最热
          </button>
        </div>
        {view === "canvas" && (
          <div className="zoom-info">
            <button onClick={resetViewport} title="重置视口">
              {Math.round(viewport.zoom * 100)}%
            </button>
            <span className="hint">滚轮 + Ctrl/⌘ 缩放 · Alt-拖动平移 · 双击新建</span>
          </div>
        )}
      </div>

      {view === "canvas" ? (
        <div
          ref={canvasRef}
          className="canvas"
          onDoubleClick={handleCanvasDoubleClick}
          onClick={handleCanvasClick}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          onWheel={handleWheel}
        >
          <div
            className="viewport"
            style={{
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* SVG layer for reply lines */}
            <svg className="reply-lines" width="20000" height="20000">
              {snapshot
                .filter((s) => s.parentId && byId.has(s.parentId))
                .map((s) => {
                  const p = byId.get(s.parentId!)!;
                  if (!filteredSet.has(s.id) || !filteredSet.has(p.id)) return null;
                  return (
                    <line
                      key={s.id + "->" + p.id}
                      x1={p.x + getW(p) / 2}
                      y1={p.y + getH(p) / 2}
                      x2={s.x + getW(s) / 2}
                      y2={s.y + getH(s) / 2}
                      stroke="#5566ee"
                      strokeOpacity={0.45}
                      strokeWidth={2}
                      strokeDasharray="6 4"
                    />
                  );
                })}
            </svg>

            {filtered.map((s) => (
              <Sticky
                key={s.id}
                note={s}
                editable={!!adminToken || s.authorId === identity.id}
                canDelete={!!adminToken || s.authorId === identity.id}
                selected={s.id === selectedId}
                highlighted={s.id === highlightedId}
                viewportZoom={viewport.zoom}
                identityId={identity.id}
                replyCount={(repliesByParent.get(s.id) ?? []).length}
                onSelect={() => setSelectedId(s.id)}
                onUpdate={(patch) => updateSticky(s.id, patch)}
                onDelete={() => deleteSticky(s.id)}
                onReact={(e) => toggleReaction(s.id, e)}
              />
            ))}

            {/* Presence cursors */}
            {presence.map((p) => (
              <div
                key={p.clientId}
                className="presence-cursor"
                style={{
                  left: p.cursorX,
                  top: p.cursorY,
                  ["--cursor-color" as string]: safeRenderColor(p.color),
                }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M2 2 L18 12 L11 13 L8 21 Z" fill={safeRenderColor(p.color)} />
                </svg>
                <span className="presence-name" style={{ background: safeRenderColor(p.color) }}>
                  {p.name}
                </span>
              </div>
            ))}
          </div>

          {selected && (!!adminToken || selected.authorId === identity.id) && (
            <Toolbar
              note={selected}
              viewport={viewport}
              onUpdate={(patch) => updateSticky(selected.id, patch)}
              onDelete={() => deleteSticky(selected.id)}
              onBringToFront={() => bringToFront(selected.id)}
              onSendToBack={() => sendToBack(selected.id)}
              onReply={() => replyTo(selected.id)}
              onCopyLink={() => copyPermalink(selected.id)}
            />
          )}
        </div>
      ) : (
        <FeedView
          items={sortedForFeed}
          identityId={identity.id}
          adminToken={!!adminToken}
          onJump={(id) => {
            setView("canvas");
            setHighlightedId(id);
            setSelectedId(id);
            const s = byId.get(id);
            if (s) {
              const el = canvasRef.current;
              if (el) {
                const r = el.getBoundingClientRect();
                setViewport({
                  zoom: 1,
                  panX: r.width / 2 - (s.x + getW(s) / 2),
                  panY: r.height / 2 - (s.y + getH(s) / 2),
                });
              }
            }
            setTimeout(() => setHighlightedId(null), 2400);
          }}
          onReact={toggleReaction}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ─── Sticky ────────────────────────────────────────────────────────────────

function Sticky({
  note,
  editable,
  canDelete,
  selected,
  highlighted,
  viewportZoom,
  identityId,
  replyCount,
  onSelect,
  onUpdate,
  onDelete,
  onReact,
}: {
  note: StickyNote;
  editable: boolean;
  canDelete: boolean;
  selected: boolean;
  highlighted: boolean;
  viewportZoom: number;
  identityId: string;
  replyCount: number;
  onSelect: () => void;
  onUpdate: (patch: Partial<StickyNote>) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}) {
  const dragState = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const resizeState = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    corner: "br" | "bl" | "tr" | "tl";
  } | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);

  const shape = getShape(note);
  const w = getW(note);
  const h = getH(note);
  const fontSize = getFontSize(note);
  const z = getZ(note);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    if ((e.target as HTMLElement).closest(".resize-handle")) return;
    if ((e.target as HTMLElement).closest(".react-bar")) return;
    e.stopPropagation();
    if (!editable) {
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
    const dx = (e.clientX - s.startX) / viewportZoom;
    const dy = (e.clientY - s.startY) / viewportZoom;
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

  function onResizeDown(e: React.PointerEvent<HTMLDivElement>, corner: "br" | "bl" | "tr" | "tl") {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: w,
      origH: h,
      corner,
    };
  }

  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = resizeState.current;
    if (!r) return;
    const dx = (e.clientX - r.startX) / viewportZoom;
    const dy = (e.clientY - r.startY) / viewportZoom;
    let newW = r.origW;
    let newH = r.origH;
    if (r.corner === "br") {
      newW = r.origW + dx;
      newH = r.origH + dy;
    } else if (r.corner === "bl") {
      newW = r.origW - dx;
      newH = r.origH + dy;
    } else if (r.corner === "tr") {
      newW = r.origW + dx;
      newH = r.origH - dy;
    } else if (r.corner === "tl") {
      newW = r.origW - dx;
      newH = r.origH - dy;
    }
    if (shape === "circle") {
      const sized = Math.max(newW, newH);
      onUpdate({ w: clamp(sized, W_MIN, W_MAX) });
    } else {
      onUpdate({
        w: clamp(newW, W_MIN, W_MAX),
        h: clamp(newH, H_MIN, H_MAX),
      });
    }
  }

  function onResizeUp(e: React.PointerEvent<HTMLDivElement>) {
    if (resizeState.current) {
      (e.target as Element).releasePointerCapture(e.pointerId);
      resizeState.current = null;
    }
  }

  function insertEmoji(emoji: string) {
    onUpdate({ text: (note.text ?? "") + emoji });
    setPickerOpen(false);
  }

  const style: React.CSSProperties = {
    left: note.x,
    top: note.y,
    width: w,
    height: h,
    background: safeRenderColor(note.color),
    borderRadius: shape === "sticky" ? 6 : shape === "rect" ? 0 : "50%",
    fontSize: `${fontSize}px`,
    zIndex: z + (selected ? 5000 : 0),
  };

  const className =
    "sticky" +
    (shape === "circle" ? " sticky-circle" : "") +
    (selected ? " sticky-selected" : "") +
    (highlighted ? " sticky-highlighted" : "");

  const reactions = note.reactions ?? {};
  const reactionEntries = Object.entries(reactions).filter(([, ids]) => ids.length > 0);

  return (
    <div
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="sticky-author">
        {note.authorName}
        {note.parentId && <span className="reply-marker">↳</span>}
        {replyCount > 0 && <span className="reply-count">{replyCount} 回复</span>}
      </div>
      <textarea
        value={note.text}
        placeholder="说点什么..."
        readOnly={!editable}
        onChange={(e) => onUpdate({ text: e.target.value })}
        style={{ fontSize: `${fontSize}px` }}
      />

      {/* Reactions bar */}
      <div className="react-bar" onClick={(e) => e.stopPropagation()}>
        {reactionEntries.map(([emoji, ids]) => (
          <button
            key={emoji}
            className={"react-pill" + (ids.includes(identityId) ? " mine" : "")}
            onClick={(e) => {
              e.stopPropagation();
              onReact(emoji);
            }}
            title={`${ids.length} 人`}
          >
            <span>{emoji}</span>
            <span className="react-num">{ids.length}</span>
          </button>
        ))}
        <button
          className="react-add"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((v) => !v);
          }}
          title="加反应 / 插表情"
        >
          +
        </button>
      </div>

      {pickerOpen && (
        <EmojiPicker
          onPickReaction={(e) => {
            onReact(e);
            setPickerOpen(false);
          }}
          onPickText={(e) => insertEmoji(e)}
          showText={editable}
        />
      )}

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

      {/* Resize handles */}
      {selected && editable && (
        <>
          <div
            className="resize-handle resize-br"
            onPointerDown={(e) => onResizeDown(e, "br")}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
          <div
            className="resize-handle resize-bl"
            onPointerDown={(e) => onResizeDown(e, "bl")}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
          <div
            className="resize-handle resize-tr"
            onPointerDown={(e) => onResizeDown(e, "tr")}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
          <div
            className="resize-handle resize-tl"
            onPointerDown={(e) => onResizeDown(e, "tl")}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
        </>
      )}
    </div>
  );
}

// ─── Emoji picker ──────────────────────────────────────────────────────────

function EmojiPicker({
  onPickReaction,
  onPickText,
  showText,
}: {
  onPickReaction: (e: string) => void;
  onPickText: (e: string) => void;
  showText: boolean;
}) {
  return (
    <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
      <div className="emoji-section-label">反应</div>
      <div className="emoji-grid">
        {EMOJIS_REACTION.map((e) => (
          <button key={"r" + e} onClick={() => onPickReaction(e)}>
            {e}
          </button>
        ))}
      </div>
      {showText && (
        <>
          <div className="emoji-section-label">插入</div>
          <div className="emoji-grid">
            {EMOJIS_QUICK.map((e) => (
              <button key={"t" + e} onClick={() => onPickText(e)}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Toolbar ───────────────────────────────────────────────────────────────

function Toolbar({
  note,
  viewport,
  onUpdate,
  onDelete,
  onBringToFront,
  onSendToBack,
  onReply,
  onCopyLink,
}: {
  note: StickyNote;
  viewport: Viewport;
  onUpdate: (patch: Partial<StickyNote>) => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onReply: () => void;
  onCopyLink: () => void;
}) {
  const w = getW(note);
  const h = getH(note);
  const fontSize = getFontSize(note);
  const shape = getShape(note);

  // Toolbar is fixed-position relative to the canvas viewport — convert
  // sticky world coords back to viewport pixels.
  const screenLeft = viewport.panX + note.x * viewport.zoom;
  const screenTop = viewport.panY + note.y * viewport.zoom - 56;

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
      style={{ left: Math.max(8, screenLeft), top: Math.max(8, screenTop) }}
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
        <button className="tb-btn" onClick={() => patchW(-W_STEP)}>−</button>
        <span className="tb-num">{Math.round(w)}</span>
        <button className="tb-btn" onClick={() => patchW(W_STEP)}>+</button>
        <span className="tb-label">H</span>
        <button className="tb-btn" onClick={() => patchH(-H_STEP)}>−</button>
        <span className="tb-num">{Math.round(h)}</span>
        <button className="tb-btn" onClick={() => patchH(H_STEP)}>+</button>
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
        {SHAPE_PRESETS.map((s: { value: StickyShape; label: string; title: string }) => (
          <button
            key={s.value}
            className={"tb-shape" + (shape === s.value ? " active" : "")}
            onClick={() => {
              const patch: Partial<StickyNote> = { shape: s.value };
              if (s.value === "circle" && w < 140) patch.w = 140;
              onUpdate(patch);
            }}
            title={s.title}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="tb-divider" />
      <div className="tb-group" title="层级 / 操作">
        <button className="tb-btn" onClick={onBringToFront} title="置顶">⤴</button>
        <button className="tb-btn" onClick={onSendToBack} title="置底">⤵</button>
        <button className="tb-btn" onClick={onReply} title="回复">↳</button>
        <button className="tb-btn" onClick={onCopyLink} title="复制链接">🔗</button>
      </div>
      <div className="tb-divider" />
      <button className="tb-danger" onClick={onDelete} title="删除">
        删除
      </button>
    </div>
  );
}

// ─── Feed (list) view ──────────────────────────────────────────────────────

function FeedView({
  items,
  identityId,
  adminToken,
  onJump,
  onReact,
}: {
  items: StickyNote[];
  identityId: string;
  adminToken: boolean;
  onJump: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
}) {
  return (
    <div className="feed">
      {items.length === 0 ? (
        <div className="empty">没有符合的便利贴</div>
      ) : (
        items.map((s) => {
          const total = reactionCount(s);
          return (
            <article key={s.id} className="feed-row">
              <span className="dot" style={{ background: safeRenderColor(s.color) }} />
              <div className="feed-meta">
                <div className="feed-author">{s.authorName}</div>
                <div className="feed-ts">{new Date(s.ts).toLocaleString("zh-CN")}</div>
              </div>
              <div className="feed-text">
                {s.parentId && <span className="reply-marker">↳ </span>}
                {s.text || <em className="muted">(空)</em>}
              </div>
              <div className="feed-actions">
                {EMOJIS_REACTION.map((e) => (
                  <button
                    key={e}
                    className={
                      "react-pill mini" +
                      ((s.reactions?.[e] ?? []).includes(identityId) ? " mine" : "")
                    }
                    onClick={() => onReact(s.id, e)}
                    title={`${(s.reactions?.[e] ?? []).length} 人`}
                  >
                    {e}
                    {(s.reactions?.[e] ?? []).length > 0 && (
                      <span className="react-num">{(s.reactions![e] ?? []).length}</span>
                    )}
                  </button>
                ))}
                <span className="muted">{total > 0 ? `总 ${total}` : ""}</span>
              </div>
              <button className="btn-link" onClick={() => onJump(s.id)}>
                跳到画布
              </button>
              {adminToken && <span className="badge-admin small">admin</span>}
            </article>
          );
        })
      )}
    </div>
  );
}


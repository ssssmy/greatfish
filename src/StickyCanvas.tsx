import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { nanoid } from "nanoid";
import type { Identity } from "./identity";
import { encodeIdentityForWire, isValidHexColor, PALETTE } from "./identity";
import { filterText } from "./filter";

export type StickyNote = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  authorId: string;
  authorName: string;
  ts: number;
};

type Props = {
  channel: string;
  identity: Identity;
  partyHost: string;
  /** Admin token; if supplied and accepted by the server, admin gains
   *  delete/edit access to any sticky. The server is the source of truth. */
  adminToken?: string;
};

type ConnState = "connecting" | "connected" | "disconnected";

const CREATE_LIMIT = 10; // stickies per CREATE_WINDOW
const CREATE_WINDOW_MS = 60_000;
const FALLBACK_COLOR = "#888";

function safeRenderColor(value: unknown): string {
  return isValidHexColor(value) ? value : FALLBACK_COLOR;
}

export function StickyCanvas({ channel, identity, partyHost, adminToken }: Props) {
  const stickiesRef = useRef<Y.Map<StickyNote> | null>(null);
  const [snapshot, setSnapshot] = useState<StickyNote[]>([]);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [toast, setToast] = useState<string | null>(null);
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
    // Always use our own identity color from the palette to keep the value
    // safe even if a future bug leaks a non-palette value into the type.
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
    };
    stickies.set(note.id, note);
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    addStickyAt(e.clientX - rect.left - 80, e.clientY - rect.top - 40);
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

    // Never let the client mutate authorId / authorName even by accident —
    // the server would reject, but this keeps optimistic local state honest.
    const safePatch: Partial<StickyNote> = { ...patch };
    delete safePatch.authorId;
    delete safePatch.authorName;
    if (safePatch.color !== undefined && !isValidHexColor(safePatch.color)) {
      delete safePatch.color;
    }

    stickies.set(id, { ...existing, ...safePatch, ts: Date.now() });
  }

  function deleteSticky(id: string) {
    stickiesRef.current?.delete(id);
  }

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
          <span className="hint">双击空白处贴便利贴</span>
        </div>
      </header>
      <div ref={canvasRef} className="canvas" onDoubleClick={handleDoubleClick}>
        {snapshot.map((s) => (
          <Sticky
            key={s.id}
            note={s}
            editable={!!adminToken || s.authorId === identity.id}
            canDelete={!!adminToken || s.authorId === identity.id}
            onUpdate={(patch) => updateSticky(s.id, patch)}
            onDelete={() => deleteSticky(s.id)}
          />
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Sticky({
  note,
  editable,
  canDelete,
  onUpdate,
  onDelete,
}: {
  note: StickyNote;
  editable: boolean;
  canDelete: boolean;
  onUpdate: (patch: Partial<StickyNote>) => void;
  onDelete: () => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    if (!editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: note.x,
      origY: note.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s) return;
    onUpdate({ x: s.origX + (e.clientX - s.startX), y: s.origY + (e.clientY - s.startY) });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragState.current = null;
    }
  }

  return (
    <div
      className="sticky"
      style={{
        left: note.x,
        top: note.y,
        background: safeRenderColor(note.color),
      }}
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
      />
      {canDelete && (
        <button className="sticky-delete" onClick={onDelete} title="删除">
          ×
        </button>
      )}
    </div>
  );
}

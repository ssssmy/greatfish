import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import type { StickyNote } from "./StickyCanvas";

type RoomState = {
  slug: string;
  stickies: StickyNote[];
  connected: boolean;
};

type Props = {
  channels: { slug: string; name: string }[];
  partyHost: string;
};

const ADMIN_KEY = "greatfish.admin.token";

function getStoredToken(): string | null {
  return localStorage.getItem(ADMIN_KEY);
}

function storeToken(token: string) {
  localStorage.setItem(ADMIN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(ADMIN_KEY);
}

// Client-side admin gate. The only acceptable tokens are listed here.
// Anyone reading the JS bundle can see these strings — this is intentionally
// only "stop a casual passerby" level security, not real auth. The proper
// fix (server-side ADMIN_TOKEN check inside party/index.ts) is V2 work.
//
// VITE_ADMIN_TOKEN is read at build time from .env.production (or the
// deploy-web.yml workflow env). If set, that exact value is also accepted
// — letting you use the same long random token everywhere without baking
// the dev token into prod.
const DEV_TOKEN = "greatfish-admin-dev";
const PROD_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN ?? "").trim();

function isAcceptable(input: string): boolean {
  if (!input) return false;
  if (import.meta.env.DEV && input === DEV_TOKEN) return true;
  if (PROD_TOKEN && input === PROD_TOKEN) return true;
  return false;
}

export function Admin({ channels, partyHost }: Props) {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="page">
        <Link to="/" className="back">
          ← 回首页
        </Link>
        <h1>admin · 登录</h1>
        <p className="muted">
          {import.meta.env.DEV
            ? "Dev 环境,默认 token: greatfish-admin-dev。"
            : "需要正确的 admin token。"}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isAcceptable(draft)) {
              storeToken(draft);
              setToken(draft);
              setError("");
            } else {
              setError("token 错误");
            }
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="admin token"
            className="input"
            autoFocus
          />
          <button type="submit" className="btn">
            进入
          </button>
          {error && <p className="muted" style={{ color: "#ef4444", marginTop: 8 }}>{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="admin-bar">
        <Link to="/" className="back">
          ← 回首页
        </Link>
        <button
          className="btn-link"
          onClick={() => {
            clearToken();
            setToken(null);
          }}
        >
          登出
        </button>
      </div>
      <h1>admin · 公共瓜区监控</h1>
      <p className="muted">
        全部频道的便利贴按时间倒序。点删除按钮 = Yjs 直接 delete,所有在线客户端会立刻看到。
      </p>
      {channels.map((c) => (
        <AdminChannel key={c.slug} slug={c.slug} name={c.name} partyHost={partyHost} />
      ))}
    </div>
  );
}

function AdminChannel({
  slug,
  name,
  partyHost,
}: {
  slug: string;
  name: string;
  partyHost: string;
}) {
  const stickiesRef = useRef<Y.Map<StickyNote> | null>(null);
  const [state, setState] = useState<RoomState>({
    slug,
    stickies: [],
    connected: false,
  });

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(partyHost, slug, doc, { party: "main" });
    const stickies = doc.getMap<StickyNote>("stickies");
    stickiesRef.current = stickies;

    const refresh = () => {
      const arr = Array.from(stickies.values()).sort((a, b) => b.ts - a.ts);
      setState((s) => ({ ...s, stickies: arr }));
    };
    stickies.observe(refresh);
    refresh();

    const onStatus = (e: { status: "connecting" | "connected" | "disconnected" }) => {
      setState((s) => ({ ...s, connected: e.status === "connected" }));
    };
    provider.on("status", onStatus);
    if (provider.wsconnected) {
      setState((s) => ({ ...s, connected: true }));
    }

    return () => {
      stickies.unobserve(refresh);
      provider.off("status", onStatus);
      provider.destroy();
      doc.destroy();
      stickiesRef.current = null;
    };
  }, [slug, partyHost]);

  function del(id: string) {
    stickiesRef.current?.delete(id);
  }

  return (
    <section className="admin-channel">
      <h2>
        #{slug} · {name}{" "}
        <span className={state.connected ? "conn conn-connected" : "conn conn-disconnected"}>
          {state.connected ? "live" : "offline"}
        </span>{" "}
        <span className="muted">({state.stickies.length})</span>
      </h2>
      <div className="admin-list">
        {state.stickies.length === 0 ? (
          <div className="empty">还没有便利贴</div>
        ) : (
          state.stickies.map((s) => (
            <div key={s.id} className="admin-row">
              <span className="dot" style={{ background: s.color }} />
              <span className="admin-author">{s.authorName}</span>
              <span className="admin-text">{s.text || <em className="muted">(空)</em>}</span>
              <span className="muted">{new Date(s.ts).toLocaleString("zh-CN")}</span>
              <button className="btn-link danger" onClick={() => del(s.id)}>
                删除
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function AdminLink() {
  // Tiny anchor in the footer of the home page — admin URL is unguessable
  // enough that we don't need extra obscurity in dev.
  const link = useMemo(() => "/admin", []);
  return (
    <Link to={link} className="muted">
      admin
    </Link>
  );
}

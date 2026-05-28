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

const DEV_TOKEN = "greatfish-admin-dev";

export function Admin({ channels, partyHost }: Props) {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [draft, setDraft] = useState("");

  if (!token) {
    return (
      <div className="page">
        <Link to="/" className="back">
          ← 回首页
        </Link>
        <h1>admin · 登录</h1>
        <p className="muted">
          输入 admin token。Dev 环境的默认 token 是 <code>greatfish-admin-dev</code>。
          生产环境从环境变量或部署配置读取。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft === DEV_TOKEN || draft.length > 4) {
              storeToken(draft);
              setToken(draft);
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

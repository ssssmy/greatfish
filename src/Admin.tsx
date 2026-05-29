import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import type { StickyNote } from "./StickyCanvas";
import { encodeIdentityForWire, getIdentity, isValidHexColor } from "./identity";

type RoomState = {
  slug: string;
  stickies: StickyNote[];
  connected: boolean;
  rejected: boolean;
};

type Props = {
  channels: { slug: string; name: string }[];
  partyHost: string;
};

const ADMIN_KEY = "greatfish.admin.token";
const FALLBACK_COLOR = "#888";

function getStoredToken(): string | null {
  return localStorage.getItem(ADMIN_KEY);
}

function storeToken(token: string) {
  localStorage.setItem(ADMIN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(ADMIN_KEY);
}

function safeRenderColor(value: unknown): string {
  return isValidHexColor(value) ? value : FALLBACK_COLOR;
}

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
          输入 admin token。服务端校验,错的连不上 sync server。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (t) {
              storeToken(t);
              setToken(t);
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
        全部频道的便利贴按时间倒序。删除按钮调 Yjs delete,服务端校验后所有在线
        客户端立刻看到。如果出现「连接被拒」,token 不对。
      </p>
      {channels.map((c) => (
        <AdminChannel
          key={c.slug}
          slug={c.slug}
          name={c.name}
          partyHost={partyHost}
          adminToken={token}
          onTokenRejected={() => {
            clearToken();
            setToken(null);
          }}
        />
      ))}
    </div>
  );
}

function AdminChannel({
  slug,
  name,
  partyHost,
  adminToken,
  onTokenRejected,
}: {
  slug: string;
  name: string;
  partyHost: string;
  adminToken: string;
  onTokenRejected: () => void;
}) {
  const stickiesRef = useRef<Y.Map<StickyNote> | null>(null);
  const identity = useMemo(() => getIdentity(), []);
  const [state, setState] = useState<RoomState>({
    slug,
    stickies: [],
    connected: false,
    rejected: false,
  });

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(partyHost, slug, doc, {
      party: "main",
      params: {
        identity: encodeIdentityForWire(identity),
        admin: adminToken,
      },
    });
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

    // Listen for the server's close codes so we can detect a wrong admin
    // token immediately and bounce the user back to the login form.
    //   4001 = no/bad identity (should never happen for admin since identity
    //          is mandatory and always well-formed by the client)
    //   4003 = admin token rejected by server
    //   4429 = IP rate-limited
    let disconnectCount = 0;
    const onConnectionClose = (e: { code?: number; reason?: string }) => {
      if (e?.code === 4003 || e?.code === 4001) {
        onTokenRejected();
        return;
      }
      disconnectCount++;
      if (disconnectCount > 3) {
        setState((s) => ({ ...s, rejected: true }));
      }
    };
    provider.on("connection-close", onConnectionClose);

    return () => {
      stickies.unobserve(refresh);
      provider.off("status", onStatus);
      provider.off("connection-close", onConnectionClose);
      provider.destroy();
      doc.destroy();
      stickiesRef.current = null;
    };
  }, [slug, partyHost, identity, adminToken, onTokenRejected]);

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
      {state.rejected && (
        <div className="empty" style={{ color: "#ef4444", borderColor: "#7f1d1d" }}>
          连接被拒,token 可能不对。点右上"登出"重新输入。
        </div>
      )}
      <div className="admin-list">
        {state.stickies.length === 0 ? (
          <div className="empty">还没有便利贴</div>
        ) : (
          state.stickies.map((s) => (
            <div key={s.id} className="admin-row">
              <span className="dot" style={{ background: safeRenderColor(s.color) }} />
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

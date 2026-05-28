import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { useMemo } from "react";
import { StickyCanvas } from "./StickyCanvas";
import { getIdentity } from "./identity";
import { About, Terms } from "./About";
import { Admin } from "./Admin";

const CHANNELS = [
  { slug: "work-tea", name: "职场瓜", desc: "Q3 销售明细" },
  { slug: "star-tea", name: "明星瓜", desc: "项目进度甘特图" },
  { slug: "love-tea", name: "感情瓜", desc: "考勤表" },
];

const PARTY_HOST =
  import.meta.env.VITE_PARTY_HOST ?? (import.meta.env.DEV ? "localhost:1999" : "");

function Home() {
  return (
    <div className="home">
      <h1>GreatFish</h1>
      <p className="tagline">摸鱼瓜区,大家随便贴</p>
      <div className="channels">
        {CHANNELS.map((c) => (
          <Link key={c.slug} to={`/c/${c.slug}`} className="channel-card">
            <div className="channel-name">#{c.slug}</div>
            <div className="channel-desc">{c.desc}</div>
            <div className="channel-label">{c.name}</div>
          </Link>
        ))}
      </div>
      <nav className="home-footer">
        <Link to="/about" className="muted">
          这是什么
        </Link>
        <Link to="/terms" className="muted">
          用户行为规范 + 免责
        </Link>
        <Link to="/admin" className="muted">
          admin
        </Link>
      </nav>
    </div>
  );
}

function ChannelView() {
  const { slug } = useParams<{ slug: string }>();
  const identity = useMemo(() => getIdentity(), []);
  if (!slug || !CHANNELS.find((c) => c.slug === slug)) {
    return <Navigate to="/" replace />;
  }
  if (!PARTY_HOST) {
    return (
      <div className="error">缺少 VITE_PARTY_HOST 环境变量,无法连接 sync server。</div>
    );
  }
  return <StickyCanvas channel={slug} identity={identity} partyHost={PARTY_HOST} />;
}

function AdminWrapper() {
  if (!PARTY_HOST) {
    return <div className="error">缺少 VITE_PARTY_HOST 环境变量。</div>;
  }
  return <Admin channels={CHANNELS} partyHost={PARTY_HOST} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/c/:slug" element={<ChannelView />} />
        <Route path="/about" element={<About />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/admin" element={<AdminWrapper />} />
      </Routes>
    </BrowserRouter>
  );
}

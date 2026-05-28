import { Link } from "react-router-dom";

export function About() {
  return (
    <div className="page">
      <Link to="/" className="back">
        ← 回首页
      </Link>
      <h1>这是什么</h1>
      <p>
        GreatFish 是一张所有人都能贴便利贴的公共画布,按主题分频道。打开 URL
        就能用,不需要注册、不需要邀请、不需要建文档。
      </p>
      <p>它的灵感来自最近网上很火的"在共享 Excel 上聊天"那个梗。</p>
      <h2 className="mt">怎么用</h2>
      <ul>
        <li>从首页选一个频道(职场瓜 / 明星瓜 / 感情瓜)</li>
        <li>双击空白处贴一张便利贴</li>
        <li>拖动便利贴改变位置,在便利贴上点字编辑</li>
        <li>右上角的 × 删除自己的便利贴</li>
      </ul>
      <h2 className="mt">技术备注</h2>
      <p className="muted">
        前端 Vite + React + Yjs。后端 PartyKit 跑在 Cloudflare Workers + Durable
        Objects,每个频道一个独立 DO,内置持久化和跨区域副本。
      </p>
    </div>
  );
}

export function Terms() {
  return (
    <div className="page">
      <Link to="/" className="back">
        ← 回首页
      </Link>
      <h1>用户行为规范</h1>
      <p>这是一个匿名公共空间。为了让大家都能用得舒服,请遵守以下规则:</p>
      <ul>
        <li>禁止广告 / 推广 / 引流(包括联系方式、二维码)</li>
        <li>禁止色情、暴力、政治敏感内容</li>
        <li>禁止人身攻击、骚扰、人肉搜索</li>
        <li>禁止刷屏、连续灌水(每分钟最多 10 条便利贴)</li>
      </ul>
      <h2 className="mt">免责声明</h2>
      <p className="muted">
        本站不收集用户身份信息,所有便利贴均为匿名发布。运营方对内容真实性、合法性不作担保;
        如发现违规内容,运营方有权随时删除,但不一定能在第一时间发现。
        使用本站即视为接受以上规范。
      </p>
      <p className="muted">
        发现违规内容,请通过 GitHub issue 或邮件联系运营方。
      </p>
    </div>
  );
}

# GreatFish · 摸鱼瓜区

> 一张所有人都能贴便利贴的公共画布,按主题分频道。打开 URL 就能用 —— 不需要
> 注册、不需要邀请、不需要建文档。灵感来自最近网上流行的"大家在共享 Excel
> 表格里摸鱼吃瓜"那个梗。

🐠 在线访问 · **<https://greatfish.ssssmy.net>**
🛰️ 同步服务 · `wss://greatfish-sync.ssssmy.partykit.dev`

---

## 这是什么

三张公共画布(`work-tea` / `star-tea` / `love-tea`),每张背后是一个独立的
[Cloudflare Durable Object](https://developers.cloudflare.com/durable-objects/)。
双击画布空白处就能贴便利贴,拖动改位置,点字编辑 —— 所有打开同一个频道
的浏览器 tab 都会实时看见。

**没有聊天面板,也没有登录。** 表格本身就是对话。

这是一个 builder 项目,一个周末从 0 上线。当作"它存在"的证据看,不是消费级
产品。

## 技术栈

| 层 | 用什么 | 为什么 |
|----|--------|--------|
| 前端 | React 18 + Vite + TypeScript | 标准栈,bundle 约 180 KB gzip |
| 状态 / 同步 | [Yjs](https://github.com/yjs/yjs) + [y-partykit](https://docs.partykit.io/reference/y-partykit-api/) | CRDT,多人编辑无冲突 |
| 后端 | [PartyKit](https://www.partykit.io)(Cloudflare Workers + Durable Objects) | 一个频道一个 DO,自动扩展,无单点故障 |
| 托管 | Cloudflare Pages(前端) + PartyKit(后端) | MVP 规模下 0 元,全球边缘加速 |
| 内容过滤 | [mint-filter](https://www.npmjs.com/package/mint-filter) | 敏感词过滤,客户端 |

前端 bundle 故意做小 —— 没有用任何画布库(Excalidraw / tldraw 之类)。便利贴
是绝对定位的 div,拖拽是手写的 pointer event handler(约 200 行)。代价是
没有画布缩放 / 平移 / 框选,这些是 V2 的事。

## 本地开发(5 分钟跑起来)

```bash
# 要求:Node 20+,pnpm 10+
pnpm install
pnpm party:dev   # 启动 PartyKit dev server 在 :1999
pnpm dev         # 另开一个终端,启动 Vite 在 :5173
```

浏览器开两个窗口访问 `http://localhost:5173/c/work-tea`,双击空白处贴便利
贴,应该看到两边实时同步。

(可选)给频道填初始内容:

```bash
node scripts/seed.mjs    # 给 3 个频道各填几条种子瓜
```

跑一遍端到端 sync 回归测试:

```bash
node scripts/sync-smoke.mjs    # 两个 Yjs 客户端,A 写 B 读,验证打通
```

## 项目结构

```
.
├── party/index.ts          # PartyKit server(Yjs sync + IP rate limit)
├── partykit.json           # PartyKit 部署配置
├── src/
│   ├── App.tsx             # 路由: / /c/:slug /about /terms /admin
│   ├── StickyCanvas.tsx    # 画布 + 拖拽 + Yjs 绑定
│   ├── Admin.tsx           # 跨频道 admin 视图(cookie token 鉴权)
│   ├── About.tsx           # 静态内容(关于 / 用户规范)
│   ├── filter.ts           # mint-filter 封装
│   ├── identity.ts         # 匿名身份(localStorage)
│   └── index.css
├── scripts/
│   ├── seed.mjs            # 给频道填种子内容
│   ├── sync-smoke.mjs      # 端到端 sync 回归测试
│   └── proxy-bootstrap.mjs # undici 代理引导(用于网络受限环境)
└── .github/workflows/      # CI: push 自动部署
```

## 为什么便宜 + 稳定

- **一个频道一个 Durable Object。** Cloudflare 在边缘节点里跑,空闲连接走
  [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocket-hibernation)
  休眠,几乎不吃 CPU。单 DO 内存上限 128 MB,实测单频道 ~1,000 并发观察者
  / ~100 并发编辑者以下完全 OK。
- **持久化自动搞定。** y-partykit 把 Yjs 历史写到 DO storage,Cloudflare 保
  证 11 个 9 的耐久性 + 多区域副本。**没有备份脚本、没有 LevelDB、没有
  cron。**
- **限流,两层。** 服务端按 IP 限连(20/分钟/IP/频道,从 `CF-Connecting-IP`
  header 取真实 IP);客户端按浏览器 session 限新建便利贴(10/分钟)。
- **防 spam,三层。** 服务端限连 + 客户端
  [mint-filter](https://www.npmjs.com/package/mint-filter) 敏感词替换 +
  `/admin` 隐藏入口人工删帖。

## 部署

### 后端(PartyKit on Cloudflare)

```bash
pnpm party:deploy
```

首次会自动开浏览器走 GitHub OAuth。默认部署到 `https://<project>.<user>.partykit.dev`
(运行在 PartyKit 共享的 Cloudflare 账号上)。**免费额度涵盖每天 10 万请求
+ 每月 100 万 DO 操作**,MVP 远远够。

如果你的网络访问 `api.partykit.dev` 受限,`pnpm party:deploy` 自动会读
`HTTPS_PROXY` 通过 `scripts/proxy-bootstrap.mjs` 走代理:

```bash
HTTPS_PROXY=http://127.0.0.1:7897 pnpm party:deploy
```

设置 admin token(32 字节随机):

```bash
openssl rand -hex 32 | HTTPS_PROXY=http://127.0.0.1:7897 pnpm party env add ADMIN_TOKEN
```

### 前端(Cloudflare Pages)

```bash
echo "VITE_PARTY_HOST=greatfish-sync.<user>.partykit.dev" > .env.production
pnpm build
pnpm exec wrangler pages deploy ./dist --project-name=greatfish-web
```

首次 `wrangler login` 会开浏览器走 Cloudflare OAuth。

绑自定义域(zone 必须在同一个 CF 账号下):

```bash
# 给 Pages 项目加自定义域
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"greatfish.example.com"}' \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/greatfish-web/domains"

# 加 CNAME(也可以走 CF dashboard)
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"greatfish","content":"greatfish-web.pages.dev","proxied":true,"ttl":1}' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```

CNAME 加好后 SSL 证书签发约 1–2 分钟。

### GitHub Actions 自动部署

`.github/workflows/` 下三个 workflow:

- `ci.yml` —— 类型检查 + 构建,push / PR 都跑
- `deploy-web.yml` —— 修改 `src/` / `index.html` / `vite.config.ts` /
  `tsconfig.json` / `package.json` / `pnpm-lock.yaml` 时自动跑;也可在
  Actions 页手工触发
- `deploy-party.yml` —— 修改 `party/` / `partykit.json` / `package.json` /
  `pnpm-lock.yaml` 时自动跑;也可手工触发

需要在 GitHub repo 的 **Settings → Secrets and variables → Actions** 配
4 个 secret:

| Secret | 干嘛 | 怎么拿 |
|--------|------|--------|
| `CLOUDFLARE_API_TOKEN` | scope = **Cloudflare Pages: Edit** | <https://dash.cloudflare.com/profile/api-tokens> 新建 |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 CF 账号 ID | CF dashboard URL 里就有,或 `wrangler whoami` |
| `PARTYKIT_LOGIN` | PartyKit 用户名 | 通常 = GitHub 用户名,例如 `ssssmy` |
| `PARTYKIT_TOKEN` | PartyKit CI 用 JWT | `pnpm party token generate` |

## 可配置项

| 变量 | 在哪 | 默认 | 用途 |
|------|------|------|------|
| `VITE_PARTY_HOST` | `.env.local` / `.env.production` | dev 时 `localhost:1999` | 客户端连后端的域名 |
| `ADMIN_TOKEN` | PartyKit env | 未设置 | admin endpoint 的服务端 token |
| `HTTPS_PROXY` | shell env | 未设置 | 设了的话,Node fetch + dev 脚本的 `ws` 都走代理 |

## Roadmap(V2 候选)

- 用 Yjs awareness 显示其他人光标 / 在线
- 移动端友好(双指缩放、触摸优化)
- 服务端审核:DO storage 存被封禁 IP、申诉流程
- 后端自定义域(需 Workers Paid plan,$5/月)
- 按地理 / 按公司分频道(类似 Blind 的"你公司的墙")
- 阅后即焚模式(便利贴 24 小时自动消失)
- "X 人在打字" awareness 指示
- 可选稳定身份(给想要持续性的用户做轻量登录)

## 已知限制

- `/admin` 路由的鉴权目前是**客户端 localStorage 比对**,不能防有动力的
  攻击者。V2 必须改成服务端 token 校验。当前生产 ADMIN_TOKEN 跟 PartyKit
  env 里那个一致,**别贴到公开地方**。
- 身份是按浏览器存的(localStorage)。清缓存 / 换浏览器会换新身份,旧便
  利贴还在,但不再算"你的"(没法点删除)。
- 没有画图工具是有意的 —— 这是文字格子产品,不是白板。
- 移动端能用,但没特别优化。

## 致谢

- 共享 Excel 摸鱼吃瓜的那个梗本身
- [PartyKit](https://www.partykit.io) —— 让 Workers + DO + Yjs 用起来像一个工具
- [Yjs](https://github.com/yjs/yjs) —— 真的能用的 CRDT 库

## License

MIT

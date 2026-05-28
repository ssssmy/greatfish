# GreatFish · 摸鱼瓜区

> A public anonymous sticky-note board, one canvas per topic. Open the URL —
> you're in. No account, no invite, no document creation step. Inspired by
> the recent meme of "everyone chatting on a shared Excel sheet at work".

🐠 Live · **<https://greatfish.ssssmy.net>**
🛰️ Sync server · `wss://greatfish-sync.ssssmy.partykit.dev`

---

## What is this

Three public canvases (`work-tea` / `star-tea` / `love-tea`), each backed by
its own [Durable Object](https://developers.cloudflare.com/durable-objects/).
Double-click a canvas to drop a sticky, drag it around, type into it — every
other open browser tab sees the change in real time.

There is no chat panel. There is no login. The grid **is** the conversation.

This is a builder project, shipped in a weekend. Treat it as an existence
proof, not a polished consumer product.

## Stack

| Layer | What | Why |
|-------|------|-----|
| Frontend | React 18 + Vite + TypeScript | Standard, ~180 KB gzip bundle |
| State / sync | [Yjs](https://github.com/yjs/yjs) + [y-partykit](https://docs.partykit.io/reference/y-partykit-api/) | CRDT, conflict-free multi-user edits |
| Backend | [PartyKit](https://www.partykit.io) on Cloudflare Workers + Durable Objects | One DO per channel; auto-scales, no SPOF |
| Hosting | Cloudflare Pages (frontend) + PartyKit (backend) | $0 at MVP scale, global edge |
| Filtering | [mint-filter](https://www.npmjs.com/package/mint-filter) | Sensitive-word screening, client-side |

The frontend bundle is intentionally small — there is no canvas library
(Excalidraw, tldraw, etc.). Stickies are absolute-positioned divs with a
hand-written drag handler (~200 lines). The trade-off is no zoom / pan /
multi-select; that's V2 work.

## Quickstart (local dev)

```bash
# Requirements: Node 20+, pnpm
pnpm install
pnpm party:dev   # starts PartyKit dev server on :1999
pnpm dev         # starts Vite on :5173  (run in a separate terminal)
```

Open `http://localhost:5173/c/work-tea` in two browser windows. Double-click
to add stickies; you should see edits sync across windows in real time.

Optional, populate the channels with seed content:

```bash
node scripts/seed.mjs    # writes 13 starter stickies across 3 channels
```

Verify end-to-end sync programmatically:

```bash
node scripts/sync-smoke.mjs    # two Yjs clients, one writes, the other reads
```

## Project layout

```
.
├── party/index.ts          # PartyKit server (Yjs sync + IP rate limit)
├── partykit.json           # PartyKit deploy config
├── src/
│   ├── App.tsx             # Routes: / /c/:slug /about /terms /admin
│   ├── StickyCanvas.tsx    # The canvas + drag + Yjs binding
│   ├── Admin.tsx           # Cross-channel admin view (cookie-token gated)
│   ├── About.tsx           # Static content
│   ├── filter.ts           # mint-filter wrapper
│   ├── identity.ts         # Anonymous identity (localStorage)
│   └── index.css
├── scripts/
│   ├── seed.mjs            # Populate channels with starter stickies
│   ├── sync-smoke.mjs      # End-to-end sync regression test
│   └── proxy-bootstrap.mjs # undici proxy bootstrap (for HTTPS_PROXY support)
└── .github/workflows/      # CI: auto-deploy on push to main
```

## How it stays cheap and reliable

- **One Durable Object per channel.** Cloudflare runs them at the edge,
  hibernating idle connections via the
  [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocket-hibernation).
  Per-DO memory ceiling is 128 MB; expected ceiling per channel is roughly
  1,000 concurrent viewers / 100 concurrent active editors before sharding.
- **Persistence is automatic.** y-partykit writes Yjs history to DO storage.
  No backups, no LevelDB, no cron jobs — Cloudflare guarantees 11 nines of
  durability across regions.
- **Rate limit, two layers.** The server caps connections at 20 per minute
  per IP per room (read from `CF-Connecting-IP`). The client throttles new
  sticky creation at 10 per minute per browser session.
- **Spam, three layers.** Server-side rate limit, client+server sensitive
  word filtering ([mint-filter](https://www.npmjs.com/package/mint-filter)),
  plus a hidden `/admin` endpoint for human-in-the-loop deletion.

## Deployment

### Backend (PartyKit on Cloudflare)

```bash
pnpm party:deploy
```

First time only, this opens a browser for GitHub OAuth. The default deploy
publishes to `https://<project>.<username>.partykit.dev` on PartyKit's
shared Cloudflare account. **Free tier covers ~100K requests/day and
1M Durable Object operations/month**, ample for an MVP.

Custom backend domain (e.g. `greatfish-sync.example.com`) requires
deploying to your own Cloudflare account, which in turn requires the
Workers Paid plan ($5/month) because Durable Objects are not on the free
Workers plan. For now we keep the `.partykit.dev` subdomain.

If your network blocks `api.partykit.dev`, the `pnpm party:deploy` script
auto-routes through `HTTPS_PROXY` via `scripts/proxy-bootstrap.mjs`:

```bash
HTTPS_PROXY=http://127.0.0.1:7897 pnpm party:deploy
```

Set the admin token (random 32-byte hex):

```bash
openssl rand -hex 32 | HTTPS_PROXY=http://127.0.0.1:7897 npx partykit env add ADMIN_TOKEN
```

### Frontend (Cloudflare Pages)

```bash
echo "VITE_PARTY_HOST=greatfish-sync.<username>.partykit.dev" > .env.production
pnpm build
pnpm exec wrangler pages deploy ./dist --project-name=greatfish-web
```

First-time `wrangler login` opens a browser for Cloudflare OAuth.

To bind a custom domain to the Pages project (zone must be on the same
Cloudflare account):

```bash
# Add the domain to the Pages project (uses your CF API token)
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"greatfish.example.com"}' \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/greatfish-web/domains"

# Add the CNAME (also via CF API, or via the dashboard)
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"greatfish","content":"greatfish-web.pages.dev","proxied":true,"ttl":1}' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```

SSL provisioning takes ~1–2 minutes after the CNAME is in place.

### Continuous deployment via GitHub Actions

Two workflows in `.github/workflows/`:

- `deploy-web.yml` — builds and deploys the frontend on pushes that touch
  `src/`, `index.html`, `vite.config.ts`, or `package.json`.
- `deploy-party.yml` — deploys the PartyKit backend on pushes that touch
  `party/`, `partykit.json`, or `package.json`.

These require the following GitHub Actions secrets (set them in
**Settings → Secrets and variables → Actions** on the GitHub repo):

| Secret | What | How to obtain |
|--------|------|---------------|
| `CLOUDFLARE_API_TOKEN` | CF token with **Cloudflare Pages: Edit** scope | Create at <https://dash.cloudflare.com/profile/api-tokens> |
| `CLOUDFLARE_ACCOUNT_ID` | Your account id | Read from CF dashboard URL, or `wrangler whoami` |
| `PARTYKIT_LOGIN` | PartyKit CI token | `npx partykit token generate` |

Both workflows have `workflow_dispatch` triggers so you can deploy manually
from the Actions tab as well.

## Configuration knobs

| Variable | Where | Default | Purpose |
|----------|-------|---------|---------|
| `VITE_PARTY_HOST` | `.env.local` / `.env.production` | `localhost:1999` (dev) | Hostname the client uses to reach the sync server |
| `ADMIN_TOKEN` | PartyKit env var | unset | Server-side token for the admin endpoint (set via `partykit env add`) |
| `HTTPS_PROXY` | shell env | unset | If set, the proxy bootstrap routes Node fetch (and the `ws` client in dev scripts) through this proxy |

## Roadmap (V2 candidates)

- Cursors / presence via Yjs awareness — see who else is on the canvas right now
- Mobile-friendly canvas (pinch-zoom, larger drag targets)
- Server-side moderation: persist banned IPs in DO storage, automatic appeal flow
- Custom domain for the sync server (requires Workers Paid plan)
- Geographic / per-company canvases (Blind-style "your building's wall")
- Ephemeral content mode (24-hour TTL stickies)
- Awareness-based "X people typing" indicator
- Optional sign-in with a stable identity for users who want continuity

## Known limitations

- The `/admin` route's auth is currently a client-side comparison against a
  localStorage token. It is **not** secure against a determined attacker who
  reads the source. V2 must move auth to the server. The token saved here
  is the same that the server's admin endpoint trusts; do not paste it in
  public.
- Identity is per-browser (localStorage). Clearing site data or switching
  browsers issues a new identity; the old stickies remain but are no longer
  "yours" for delete purposes.
- Drawing tools are absent on purpose — this is a text-on-a-grid product,
  not a whiteboard.
- Mobile is functional but not optimized.

## Acknowledgements

- The shared-Excel-chat meme that inspired the product.
- [PartyKit](https://www.partykit.io) for making Cloudflare Workers + DO + Yjs feel like one tool.
- [Yjs](https://github.com/yjs/yjs) for being the CRDT library that actually works.

## License

MIT.

// Force Node's global fetch (undici) to route through HTTPS_PROXY / HTTP_PROXY.
//
// Node respects neither env var by default — that's a libcurl convention,
// not a Node one. Tools like the PartyKit CLI fail with timeouts on networks
// where some Cloudflare / partykit.dev endpoints need to go through a local
// HTTPS proxy.
//
// Load via:  node --import ./scripts/proxy-bootstrap.mjs <command...>

import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxy =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy));
  // eslint-disable-next-line no-console
  console.error(`[proxy-bootstrap] undici routed through ${proxy}`);
}

import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

/**
 * GreatFish sync server.
 *
 * Each channel (URL slug) maps to one DO instance. y-partykit handles the
 * Yjs sync protocol and persists history in DO storage.
 *
 * Enforcement on this side is intentionally coarse: per-IP connection rate
 * limit at the room edge. Content moderation runs on the client (mint-filter)
 * with admin delete as the backstop. Admin acts as a regular Yjs client
 * with elevated UI permissions — there is no server-side ownership check,
 * which is fine because deletes are persisted into the same shared doc and
 * picked up by all live clients.
 */
export default class GreatFishParty implements Party.Server {
  // ip -> recent connection timestamps (ms)
  private ipConnects = new Map<string, number[]>();

  constructor(readonly room: Party.Room) {}

  private getIp(ctx: Party.ConnectionContext): string {
    return (
      ctx.request.headers.get("cf-connecting-ip") ??
      ctx.request.headers.get("x-forwarded-for") ??
      "unknown"
    );
  }

  private shouldRateLimit(ip: string): boolean {
    // 20 connections / minute / room / IP. Loose enough to survive dev HMR
    // reconnect storms and React StrictMode double-mount, tight enough to
    // block scripted connection floods. Tune in production once we see
    // real usage patterns.
    const now = Date.now();
    const windowMs = 60_000;
    const max = 20;
    const arr = this.ipConnects.get(ip) ?? [];
    const recent = arr.filter((t) => now - t < windowMs);
    recent.push(now);
    this.ipConnects.set(ip, recent);
    return recent.length > max;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const ip = this.getIp(ctx);

    if (this.shouldRateLimit(ip)) {
      console.warn(`[${this.room.id}] rate-limited ${ip}`);
      conn.close(4429, "rate limited");
      return;
    }

    console.log(`[${this.room.id}] connect from ${ip}`);

    return onConnect(conn, this.room, {
      persist: { mode: "history" },
    });
  }
}

import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { BridgeEvent, LogEntry, LogLevel, LogsResponse, Snapshot, Transition, TransitionsResponse } from "@eaui/shared";
import type { LogTailer } from "../agent/logs.ts";
import type { AgentStore } from "../state/store.ts";

export interface ServerOptions {
  store: AgentStore;
  logs: LogTailer | null;
  token: string;
  port: number;
  /** Extra origins allowed to call the API, e.g. the Vite dev server. */
  allowedOrigins: string[];
  /** Built web app (apps/web/dist); null to serve the API only. */
  webDist: string | null;
  refreshPolicy: () => void;
}

const LOG_BATCH_MS = 250;

export function createApp(opts: ServerOptions): Hono {
  const app = new Hono();
  const cookieName = `eaui_session_${opts.port}`;
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const allowedOrigins = new Set([...[...allowedHosts].map((h) => `http://${h}`), ...opts.allowedOrigins]);
  const tokenBuf = Buffer.from(opts.token);
  const validToken = (t: string | undefined) => {
    if (!t) return false;
    const b = Buffer.from(t);
    return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf);
  };

  // Rejects requests addressed to any other host name. This is what stops DNS-rebinding attacks:
  // a malicious site that rebinds its domain to 127.0.0.1 still sends its own name in Host.
  app.use("*", async (c, next) => {
    if (!allowedHosts.has(c.req.header("host") ?? "")) return c.text("Forbidden host", 403);
    await next();
  });

  // Exchanges the one-time launch URL token for an HttpOnly cookie, then drops the token from the URL.
  app.get("/auth", (c) => {
    if (!validToken(c.req.query("token"))) return c.text("Invalid or expired link. Use the URL printed by the bridge.", 401);
    setCookie(c, cookieName, opts.token, { httpOnly: true, sameSite: "Strict", path: "/" });
    return c.redirect("/");
  });

  const requireAuth: MiddlewareHandler = async (c, next) => {
    if (!validToken(getCookie(c, cookieName))) return c.json({ error: "unauthorized" }, 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      if (origin && !allowedOrigins.has(origin)) return c.json({ error: "forbidden origin" }, 403);
    }
    await next();
  };

  const api = new Hono();
  api.use("*", requireAuth);

  api.get("/snapshot", (c) => c.json(opts.store.snapshot()));

  api.get("/transitions", (c) => {
    const limit = Math.min(Number(c.req.query("limit")) || 200, 2_000);
    const body: TransitionsResponse = { transitions: opts.store.recentTransitions(limit), historySince: opts.store.historySince };
    return c.json(body);
  });

  api.get("/logs", (c) => {
    const q = c.req.query();
    const body: LogsResponse = opts.logs
      ? {
          entries: opts.logs.query({
            minLevel: (q.minLevel || undefined) as LogLevel | undefined,
            component: q.component || undefined,
            q: q.q || undefined,
            telemetry: q.telemetry === "1",
            before: q.before ? Number(q.before) : undefined,
            limit: q.limit ? Number(q.limit) : undefined,
          }),
          source: opts.logs.dir,
          truncated: opts.logs.truncated,
        }
      : { entries: [], source: null, truncated: false };
    return c.json(body);
  });

  api.post("/policy/refresh", (c) => {
    opts.refreshPolicy();
    return c.json({ ok: true }, 202);
  });

  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: BridgeEvent) => stream.writeSSE({ event: event.type, data: JSON.stringify(event) });

      // Log lines can arrive in bursts of hundreds; batch them.
      let pendingLogs: LogEntry[] = [];
      let logTimer: NodeJS.Timeout | null = null;
      const onLogs = (entries: LogEntry[]) => {
        pendingLogs.push(...entries);
        logTimer ??= setTimeout(() => {
          logTimer = null;
          const batch = pendingLogs;
          pendingLogs = [];
          void send({ type: "logs", entries: batch });
        }, LOG_BATCH_MS);
      };
      const onSnapshot = (snapshot: Snapshot) => void send({ type: "snapshot", snapshot });
      const onTransitions = (transitions: Transition[]) => void send({ type: "transitions", transitions });

      opts.store.on("snapshot", onSnapshot);
      opts.store.on("transitions", onTransitions);
      opts.logs?.on("entries", onLogs);
      const heartbeat = setInterval(() => void stream.write(": keep-alive\n\n"), 15_000);

      await send({ type: "snapshot", snapshot: opts.store.snapshot() });

      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(heartbeat);
      if (logTimer) clearTimeout(logTimer);
      opts.store.off("snapshot", onSnapshot);
      opts.store.off("transitions", onTransitions);
      opts.logs?.off("entries", onLogs);
    }),
  );

  app.route("/api/v1", api);
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  if (opts.webDist && existsSync(opts.webDist)) {
    const dist = opts.webDist;
    app.use("/*", serveStatic({ root: dist }));
    // Client-side routes all get index.html (read per request so a rebuild doesn't need a bridge restart).
    // The page itself needs the session cookie to do anything useful.
    app.get("*", (c) => c.html(readFileSync(path.join(dist, "index.html"), "utf8")));
  } else {
    app.get("/", (c) => c.text("Bridge is running. The web app isn't built; run `pnpm build` or use the Vite dev server."));
  }

  return app;
}

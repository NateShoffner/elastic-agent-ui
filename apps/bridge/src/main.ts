/**
 * Elastic Agent UI bridge.
 *
 *   node apps/bridge/src/main.ts [--port 7700] [--no-open] [--no-elevate] [--dev]
 *                                [--socket <path>] [--install-dir <dir>] [--agent-binary <path>]
 *
 * If the agent's control socket isn't reachable with the current rights, re-launches itself elevated
 * (UAC / sudo). The unelevated launcher opens the browser, so the browser never runs elevated.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { createControlClient, watchAgent } from "./agent/control.ts";
import { readPolicy } from "./agent/inspect.ts";
import { LogTailer } from "./agent/logs.ts";
import { normalizeState } from "./agent/normalize.ts";
import { createApp } from "./http/server.ts";
import { isElevated, startElevated } from "./platform/elevate.ts";
import { openBrowser } from "./platform/open.ts";
import { discoverAgent, findLogDir, type AgentPaths } from "./platform/paths.ts";
import { readService } from "./platform/service.ts";
import { AgentStore } from "./state/store.ts";
import { errorMessage, sleep } from "./util.ts";

const DEV_ORIGIN = "http://localhost:5173";
const SERVICE_POLL_MS = 10_000;

const { values: opts } = parseArgs({
  options: {
    port: { type: "string", default: "7700" },
    socket: { type: "string" },
    "install-dir": { type: "string" },
    "agent-binary": { type: "string" },
    "no-open": { type: "boolean", default: false },
    "no-elevate": { type: "boolean", default: false },
    dev: { type: "boolean", default: false },
    "elevated-child": { type: "boolean", default: false },
    "ready-file": { type: "string" },
  },
});

const overrides = { installDir: opts["install-dir"], socket: opts.socket, binary: opts["agent-binary"] };
const paths = await discoverAgent(overrides);

if (!opts["elevated-child"] && !opts["no-elevate"] && !isElevated() && !(await canReachSocket(paths))) {
  await launchElevated();
} else {
  await runBridge();
}

async function canReachSocket(p: AgentPaths): Promise<boolean> {
  try {
    await createControlClient(p.sockets[0]!).version({}, { timeoutMs: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/** Starts the bridge elevated, waits for it to report its URL, and opens the browser from this (unelevated) process. */
async function launchElevated() {
  const readyFile = path.join(os.tmpdir(), `eaui-ready-${process.pid}-${randomBytes(4).toString("hex")}.json`);
  const forward = ["--elevated-child", "--ready-file", readyFile, "--port", opts.port!];
  if (opts.socket) forward.push("--socket", opts.socket);
  if (opts["install-dir"]) forward.push("--install-dir", opts["install-dir"]);
  if (opts["agent-binary"]) forward.push("--agent-binary", opts["agent-binary"]);
  if (opts.dev) forward.push("--dev");

  console.log(`The agent's control socket needs elevated rights. ${process.platform === "win32" ? "Accept the UAC prompt" : "Enter your sudo password"} to start the bridge.`);
  let child;
  try {
    child = await startElevated(import.meta.url, forward);
  } catch (err) {
    console.error(`Couldn't elevate: ${errorMessage(err)}`);
    process.exit(1);
  }

  const deadline = Date.now() + 60_000;
  let url: string | null = null;
  while (Date.now() < deadline && child?.exitCode == null) {
    if (existsSync(readyFile)) {
      try {
        url = (JSON.parse(readFileSync(readyFile, "utf8")) as { url: string }).url;
        break;
      } catch {} // still being written
    }
    await sleep(250);
  }
  rmSync(readyFile, { force: true });
  if (!url) {
    console.error("The bridge didn't start. Check its window/output for errors.");
    process.exit(1);
  }

  console.log(`\nElastic Agent UI: ${url}`);
  if (!opts["no-open"]) openBrowser(url);
  if (child) {
    // Unix: sudo runs in this terminal; stay attached so Ctrl+C stops it.
    child.on("exit", (code) => process.exit(code ?? 0));
  } else {
    console.log("The bridge is running in its own window. Close that window to stop it.");
  }
}

async function runBridge() {
  if (opts["elevated-child"] && process.platform === "win32") process.title = "Elastic Agent UI bridge";
  const socket = paths.sockets[0]!;
  const store = new AgentStore(socket);
  const abort = new AbortController();

  const logDir = paths.installDir ? findLogDir(paths.installDir) : null;
  const logs = logDir ? new LogTailer(logDir) : null;
  void logs?.run(abort.signal);

  // Policy (inspect): slow, so single-flight and only on demand.
  let policyRunning = false;
  let policyQueued = false;
  const refreshPolicy = () => {
    if (!paths.binary) return;
    if (policyRunning) {
      policyQueued = true;
      return;
    }
    policyRunning = true;
    void readPolicy(paths.binary).then((policy) => {
      store.setPolicy(policy);
      policyRunning = false;
      if (policyQueued) {
        policyQueued = false;
        refreshPolicy();
      }
    });
  };
  store.on("componentsChanged", refreshPolicy);

  let everConnected = false;
  void watchAgent(
    socket,
    {
      onStatus(status, error) {
        store.setConnection(status, error);
        if (status === "connected" && !everConnected) {
          everConnected = true;
          refreshPolicy();
        }
      },
      onState(state) {
        store.setStatus(normalizeState(state));
      },
    },
    abort.signal,
  );

  void (async () => {
    while (!abort.signal.aborted) {
      store.setService(await readService(paths));
      await sleep(SERVICE_POLL_MS, abort.signal);
    }
  })();

  const token = randomBytes(24).toString("base64url");
  const requestedPort = Number(opts.port);
  let server: Server | null = null;
  let port = requestedPort;
  for (; port < requestedPort + 10; port++) {
    const app = createApp({
      store,
      logs,
      token,
      port,
      allowedOrigins: opts.dev ? [DEV_ORIGIN] : [],
      webDist: path.resolve(import.meta.dirname, "../../web/dist"),
      refreshPolicy,
    });
    server = await listen(app.fetch, port).catch(() => null);
    if (server) break;
  }
  if (!server) {
    console.error(`No free port in ${requestedPort}-${requestedPort + 9}.`);
    process.exit(1);
  }

  const base = opts.dev ? DEV_ORIGIN : `http://127.0.0.1:${port}`;
  const url = `${base}/auth?token=${token}`;
  console.log(`Elastic Agent UI bridge`);
  console.log(`  agent socket: ${socket}`);
  console.log(`  install dir:  ${paths.installDir ?? "(not found)"}`);
  console.log(`  logs:         ${logDir ?? "(not found)"}`);
  console.log(`  listening:    http://127.0.0.1:${port}${opts.dev ? ` (dev UI: ${DEV_ORIGIN}, proxied)` : ""}`);
  console.log(`\nOpen: ${url}\n`);

  if (opts["ready-file"]) {
    writeFileSync(opts["ready-file"], JSON.stringify({ url }), { mode: 0o600 });
  } else if (!opts["no-open"] && !isElevated()) {
    openBrowser(url);
  }

  const shutdown = () => {
    abort.abort();
    server?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function listen(fetch: (req: Request) => Response | Promise<Response>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname: "127.0.0.1" }) as Server;
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

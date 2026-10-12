/**
 * Mock Elastic Agent for developing the UI without an elevated real agent.
 *
 *   node apps/mock-agent/src/main.ts [--socket <path>] [--install-dir <dir>]
 *
 * Serves control_v2 over a named pipe / Unix socket, and writes NDJSON logs into a fake install dir laid out
 * like the real one. Point the bridge at it with:
 *   --no-elevate --socket <socket> --install-dir <dir> --agent-binary apps/mock-agent/src/cli.ts
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import { parseArgs } from "node:util";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ElasticAgentControl } from "@eaui/control-proto";
import { MOCK_INSTALL_DIR, MOCK_SOCKET } from "./defaults.ts";
import { startLogWriter } from "./logs.ts";
import { VERSION, buildState, createSim, step } from "./scenario.ts";

const { values: opts } = parseArgs({
  options: {
    socket: { type: "string", default: MOCK_SOCKET },
    "install-dir": { type: "string", default: MOCK_INSTALL_DIR },
  },
});
const socket = opts.socket!;
const installDir = opts["install-dir"]!;

const sim = createSim();
const watchers = new Set<() => void>();
setInterval(() => {
  step(sim);
  for (const notify of watchers) notify();
}, 250);

const handler = connectNodeAdapter({
  grpc: true,
  grpcWeb: false,
  connect: false,
  routes(router) {
    router.service(ElasticAgentControl, {
      version: () => ({ version: VERSION, commit: "mock0000", buildTime: "2026-07-15T12:28:11Z", snapshot: false, fips: false }),
      state: () => buildState(sim),
      async *stateWatch(_req, ctx) {
        yield buildState(sim);
        while (!ctx.signal.aborted) {
          await new Promise<void>((resolve) => {
            watchers.add(resolve);
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          for (const w of watchers) watchers.delete(w);
          if (!ctx.signal.aborted) yield buildState(sim);
        }
      },
      availableRollbacks: () => ({ rollbacks: [] }),
    });
  },
});

if (process.platform !== "win32" && existsSync(socket)) rmSync(socket);
const server = http2.createServer(handler);
server.listen(socket, () => {
  console.log(`Mock Elastic Agent ${VERSION}`);
  console.log(`  control socket: ${socket}`);
  console.log(`  install dir:    ${installDir}`);
});

const logDir = path.join(installDir, "data", `elastic-agent-${VERSION}-mock`, "logs");
mkdirSync(logDir, { recursive: true });
startLogWriter(logDir, sim);

const shutdown = () => {
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

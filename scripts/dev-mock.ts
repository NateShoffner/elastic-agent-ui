/**
 * Runs the whole stack against the mock agent, no elevation needed:
 *   mock agent  →  bridge (--dev, 127.0.0.1:7790)  →  Vite dev server (localhost:5173, hot reload)
 *
 *   node scripts/dev-mock.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { MOCK_CLI, MOCK_INSTALL_DIR, MOCK_SOCKET } from "../apps/mock-agent/src/defaults.ts";

const DEV_BRIDGE_PORT = 7790;
const root = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const children: ChildProcess[] = [];

function start(name: string, cmd: string, args: string[], cwd = root, env: Record<string, string> = {}) {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  const prefix = `[${name}] `;
  const pipe = (stream: NodeJS.ReadableStream) =>
    stream.on("data", (d: Buffer) => process.stdout.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(child.stdout!);
  pipe(child.stderr!);
  child.on("exit", (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown();
  });
  children.push(child);
}

function shutdown() {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start("mock", node, ["apps/mock-agent/src/main.ts"]);
await new Promise((r) => setTimeout(r, 1_000));
start("bridge", node, [
  "apps/bridge/src/main.ts",
  "--dev",
  "--no-elevate",
  "--no-open",
  // A port of its own, so a real bridge on the default 7700 doesn't collide with dev.
  "--port",
  String(DEV_BRIDGE_PORT),
  "--socket",
  MOCK_SOCKET,
  "--install-dir",
  MOCK_INSTALL_DIR,
  "--agent-binary",
  MOCK_CLI,
]);
start("web", node, [path.join(root, "apps/web/node_modules/vite/bin/vite.js")], path.join(root, "apps/web"), {
  EAUI_BRIDGE: `http://127.0.0.1:${DEV_BRIDGE_PORT}`,
});

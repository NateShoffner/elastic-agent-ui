import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { run } from "../util.ts";

export type OS = "windows" | "linux" | "darwin";

export interface AgentPaths {
  os: OS;
  installDir: string | null;
  binary: string | null;
  /** Control socket candidates in preference order. */
  sockets: string[];
  serviceName: string;
}

export function currentOS(): OS {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

// Mirrors internal/pkg/agent/application/paths in elastic/elastic-agent v9.4.4.
const DEFAULTS: Record<OS, { installDirs: string[]; sockets: string[]; serviceName: string; binaryName: string }> = {
  windows: {
    installDirs: [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Elastic", "Agent")],
    sockets: ["\\\\.\\pipe\\elastic-agent-system"],
    serviceName: "Elastic Agent",
    binaryName: "elastic-agent.exe",
  },
  linux: {
    installDirs: ["/opt/Elastic/Agent", "/var/lib/elastic-agent"],
    sockets: ["/run/elastic-agent.sock"],
    serviceName: "elastic-agent",
    binaryName: "elastic-agent",
  },
  darwin: {
    installDirs: ["/Library/Elastic/Agent"],
    sockets: ["/var/run/elastic-agent.sock"],
    serviceName: "co.elastic.elastic-agent",
    binaryName: "elastic-agent",
  },
};

export async function discoverAgent(overrides: { installDir?: string; socket?: string; binary?: string }): Promise<AgentPaths> {
  const os = currentOS();
  const d = DEFAULTS[os];
  const installDir = overrides.installDir ?? d.installDirs.find((dir) => existsSync(dir)) ?? null;

  let binary = overrides.binary ?? null;
  if (!binary && installDir && existsSync(path.join(installDir, d.binaryName))) binary = path.join(installDir, d.binaryName);
  if (!binary && os === "linux" && existsSync("/usr/bin/elastic-agent")) binary = "/usr/bin/elastic-agent"; // DEB/RPM
  if (!binary) binary = await which(d.binaryName);

  const sockets = overrides.socket
    ? [overrides.socket]
    : [
        ...d.sockets,
        // On Unix the real socket lives in the install dir; /run and /var/run hold symlinks to it.
        ...(os !== "windows" && installDir ? [path.join(installDir, "elastic-agent.sock")] : []),
      ];

  return { os, installDir, binary, sockets: [...new Set(sockets)], serviceName: d.serviceName };
}

/** Builds the command line for the agent CLI. A `.ts`/`.js` "binary" (the mock agent) runs under this Node. */
export function agentCommand(binary: string, args: string[]): [string, string[]] {
  return /\.(c|m)?(t|j)s$/.test(binary) ? [process.execPath, [binary, ...args]] : [binary, args];
}

/**
 * Picks the one directory to tail. The agent can write every entry twice (install dir, local-time
 * timestamps; and data/elastic-agent-<hash>/logs, UTC), so tailing both would duplicate everything.
 * Prefers the default data/.../logs location when it's being written to.
 */
export function findLogDir(installDir: string): string | null {
  const candidates: { dir: string; mtime: number; preferred: boolean }[] = [];
  const consider = (dir: string, preferred: boolean) => {
    const mtime = newestNdjson(dir);
    if (mtime !== null) candidates.push({ dir, mtime, preferred });
  };
  try {
    for (const d of readdirSync(path.join(installDir, "data"))) {
      if (d.startsWith("elastic-agent-")) consider(path.join(installDir, "data", d, "logs"), true);
    }
  } catch {}
  consider(installDir, false);
  if (candidates.length === 0) return null;

  const newest = Math.max(...candidates.map((c) => c.mtime));
  const recent = candidates.filter((c) => newest - c.mtime < 10 * 60_000);
  return (recent.find((c) => c.preferred) ?? recent.sort((a, b) => b.mtime - a.mtime)[0]!).dir;
}

function newestNdjson(dir: string): number | null {
  try {
    let newest: number | null = null;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ndjson")) continue;
      const m = statSync(path.join(dir, f)).mtimeMs;
      if (newest === null || m > newest) newest = m;
    }
    return newest;
  } catch {
    return null;
  }
}

async function which(name: string): Promise<string | null> {
  const res = await run(process.platform === "win32" ? "where" : "which", [name], 5_000);
  const first = res.stdout.split(/\r?\n/).find(Boolean);
  return res.code === 0 && first ? first.trim() : null;
}

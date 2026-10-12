import type { ServiceInfo } from "@eaui/shared";
import type { AgentPaths } from "./paths.ts";
import { run } from "../util.ts";

/** Reads the agent service's state from SCM, systemd, or launchd. Never throws; unknown on failure. */
export async function readService(paths: AgentPaths): Promise<ServiceInfo> {
  const base = { name: paths.serviceName, checkedAt: new Date().toISOString() };
  try {
    switch (paths.os) {
      case "windows": {
        const res = await run("sc.exe", ["queryex", paths.serviceName], 10_000);
        const field = (name: string) => res.stdout.match(new RegExp(`${name}\\s*:\\s*(.+)`))?.[1]?.trim() ?? "";
        const detail = field("STATE");
        const pid = Number(field("PID")) || null;
        const state = /RUNNING/.test(detail)
          ? "running"
          : /STOPPED/.test(detail)
            ? "stopped"
            : /START_PENDING/.test(detail)
              ? "starting"
              : /STOP_PENDING/.test(detail)
                ? "stopping"
                : "unknown";
        return { ...base, state, detail: detail || res.stdout.trim(), pid };
      }
      case "linux": {
        const res = await run("systemctl", ["show", `${paths.serviceName}.service`, "-p", "ActiveState,SubState,MainPID"], 10_000);
        const props = Object.fromEntries(
          res.stdout.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
        );
        const active = props.ActiveState ?? "";
        const state =
          active === "active" ? "running" : active === "inactive" || active === "failed" ? "stopped" : active === "activating" ? "starting" : active === "deactivating" ? "stopping" : "unknown";
        return { ...base, state, detail: `${active} (${props.SubState ?? "?"})`, pid: Number(props.MainPID) || null };
      }
      case "darwin": {
        const res = await run("launchctl", ["print", `system/${paths.serviceName}`], 10_000);
        if (res.code !== 0) return { ...base, state: "unknown", detail: res.stderr.trim(), pid: null };
        const stateLine = /^\s*state = (.+)$/m.exec(res.stdout)?.[1]?.trim() ?? "";
        const pid = Number(/^\s*pid = (\d+)$/m.exec(res.stdout)?.[1]) || null;
        return { ...base, state: stateLine === "running" ? "running" : stateLine ? "stopped" : "unknown", detail: stateLine, pid };
      }
    }
  } catch (err) {
    return { ...base, state: "unknown", detail: String(err), pid: null };
  }
}

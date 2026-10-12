import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export function isElevated(): boolean {
  if (process.platform === "win32") {
    // `net session` only succeeds in an elevated (administrator) process.
    return spawnSync("net", ["session"], { stdio: "ignore", windowsHide: true }).status === 0;
  }
  return process.getuid?.() === 0;
}

/**
 * Starts `scriptUrl` elevated with `args`.
 * - Windows: UAC prompt; the child gets its own console window and keeps running after we exit.
 *   Resolves once the prompt was accepted (or rejects if declined).
 * - Unix: sudo in the current terminal; returns the child so the caller can wait on it.
 */
export async function startElevated(scriptUrl: string, args: string[]): Promise<ChildProcess | null> {
  const script = fileURLToPath(scriptUrl);

  if (process.platform === "win32") {
    const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const argLine = [script, ...args].map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
    const command = [
      "Start-Process",
      `-FilePath ${psQuote(process.execPath)}`,
      `-ArgumentList ${psQuote(argLine)}`,
      `-WorkingDirectory ${psQuote(process.cwd())}`,
      "-Verb RunAs",
    ].join(" ");
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (res.status !== 0) throw new Error((res.stderr || "The UAC prompt was declined").trim());
    return null;
  }

  return spawn("sudo", [process.execPath, script, ...args], { stdio: "inherit" });
}

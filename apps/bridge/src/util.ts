import { execFile } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell. `code` is null if it couldn't be started or timed out. */
export function run(cmd: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code = !err ? 0 : typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : null;
        resolve({ code, stdout, stderr: stderr || (err && code === null ? errorMessage(err) : "") });
      },
    );
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code && !err.message.includes(code) ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

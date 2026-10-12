import { spawn } from "node:child_process";

/**
 * Opens `url` in the default browser. Call this from the *unelevated* process: a browser launched from
 * an elevated process would itself run elevated.
 */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

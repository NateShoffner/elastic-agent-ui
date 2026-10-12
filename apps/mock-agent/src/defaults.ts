import path from "node:path";

/** Where the mock agent listens and writes by default; also used by scripts/dev-mock.ts to point the bridge at it. */
export const MOCK_SOCKET = process.platform === "win32" ? "\\\\.\\pipe\\eaui-mock-agent" : "/tmp/eaui-mock-agent.sock";
export const MOCK_INSTALL_DIR = path.resolve(import.meta.dirname, "../.data/Agent");
export const MOCK_CLI = path.resolve(import.meta.dirname, "cli.ts");

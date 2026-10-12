import net from "node:net";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { ElasticAgentControl, type StateResponse } from "@eaui/control-proto";
import type { ConnectionStatus } from "@eaui/shared";
import { errorMessage, sleep } from "../util.ts";

export const SUPPORTED_MAJOR = 9;

export interface ControlEvents {
  onStatus(status: ConnectionStatus, error: string | null): void;
  onState(state: StateResponse): void;
}

/** Converts `unix://` / `npipe:///` URLs (as the agent writes them) to a path `net.connect` accepts. */
export function socketPath(socket: string): string {
  if (socket.startsWith("unix://")) return socket.slice("unix://".length);
  if (socket.startsWith("npipe:///")) return `\\\\.\\pipe\\${socket.slice("npipe:///".length)}`;
  return socket;
}

export function createControlClient(socket: string): Client<typeof ElasticAgentControl> {
  const transport = createGrpcTransport({
    baseUrl: "http://localhost",
    nodeOptions: { createConnection: () => net.connect(socketPath(socket)) },
  });
  return createClient(ElasticAgentControl, transport);
}

/**
 * Keeps a StateWatch stream open for as long as `signal` isn't aborted, reconnecting with backoff.
 * Checks the agent version on every (re)connect, since the agent may have been upgraded in between.
 */
export async function watchAgent(socket: string, events: ControlEvents, signal: AbortSignal): Promise<void> {
  const client = createControlClient(socket);
  let backoff = 1_000;

  while (!signal.aborted) {
    try {
      const version = await client.version({}, { timeoutMs: 5_000, signal });
      const major = Number(version.version.split(".")[0]);
      if (major !== SUPPORTED_MAJOR) {
        events.onStatus("unsupported", `Elastic Agent ${version.version} isn't supported; this UI supports ${SUPPORTED_MAJOR}.x.`);
        await sleep(30_000, signal);
        continue;
      }

      let first = true;
      for await (const state of client.stateWatch({}, { signal })) {
        if (first) {
          events.onStatus("connected", null);
          backoff = 1_000;
          first = false;
        }
        events.onState(state);
      }
      // The agent closes the stream when it restarts.
      if (!signal.aborted) events.onStatus("connecting", "State stream ended; reconnecting");
    } catch (err) {
      if (signal.aborted) return;
      events.onStatus("unreachable", errorMessage(err));
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, 10_000);
    }
  }
}

/**
 * The bridge's HTTP API contract (`/api/v1`), plus the few rules both sides must agree on
 * (state → health, log matching). Keep it dependency-free.
 */

/** Raw state names from control_v2.proto. */
export type AgentState =
  | "STARTING"
  | "CONFIGURING"
  | "HEALTHY"
  | "DEGRADED"
  | "FAILED"
  | "STOPPING"
  | "STOPPED"
  | "UPGRADING"
  | "ROLLBACK";

/** The rolled-up status the UI shows everywhere. */
export type Health = "healthy" | "starting" | "degraded" | "failed" | "unreachable" | "stopped" | "updating";

export function stateHealth(state: AgentState): Health {
  switch (state) {
    case "HEALTHY":
      return "healthy";
    case "STARTING":
    case "CONFIGURING":
      return "starting";
    case "DEGRADED":
      return "degraded";
    case "FAILED":
      return "failed";
    case "STOPPING":
    case "STOPPED":
      return "stopped";
    case "UPGRADING":
    case "ROLLBACK":
      return "updating";
  }
}

export type ConnectionStatus = "connecting" | "connected" | "unreachable" | "unsupported";

export interface Connection {
  status: ConnectionStatus;
  /** Socket or named pipe path the bridge talks to. */
  socket: string;
  error: string | null;
  /** When `status` last changed. */
  since: string;
}

export interface AgentInfo {
  id: string;
  version: string;
  commit: string;
  buildTime: string;
  snapshot: boolean;
  pid: number;
  unprivileged: boolean;
  isManaged: boolean;
  state: AgentState;
  health: Health;
  message: string;
  fleetState: AgentState;
  fleetHealth: Health;
  fleetMessage: string;
}

export interface UpgradeInfo {
  targetVersion: string;
  state: string;
  actionId: string;
  errorMsg: string | null;
}

export type UnitType = "input" | "output";

export interface Unit {
  id: string;
  type: UnitType;
  state: AgentState;
  health: Health;
  message: string;
  /** Parsed unit payload (usually `{ streams: ... }`), or null if empty/unparseable. */
  payload: unknown;
}

/**
 * How a component runs. `process`: its own child process (beat-v2-client), with a PID.
 * `otel`: in-process inside the EDOT collector (beats-receiver), sharing the collector's process.
 */
export type ComponentRuntime = "process" | "otel" | "unknown";

export interface Component {
  id: string;
  name: string;
  state: AgentState;
  health: Health;
  message: string;
  runtime: ComponentRuntime;
  pid: number | null;
  versionInfo: { name: string; meta: Record<string, string> } | null;
  units: Unit[];
}

/** A node in the OTel collector's component status tree (pipelines, receivers, exporters...). */
export interface CollectorNode {
  id: string;
  status: string;
  health: Health;
  error: string;
  timestamp: string;
  children: CollectorNode[];
}

/** From `elastic-agent inspect`; cached by the bridge because inspect is slow. */
export interface PolicyInfo {
  policyId: string | null;
  revision: number | null;
  agentId: string | null;
  fleetHosts: string[];
  outputs: { name: string; type: string }[];
  inputs: { id: string; type: string; name: string | null; package: string | null; useOutput: string | null; streams: number }[];
  logLevel: string | null;
  fetchedAt: string;
  error: string | null;
}

export interface ServiceInfo {
  name: string;
  state: "running" | "stopped" | "starting" | "stopping" | "unknown";
  /** Platform-specific detail, e.g. `4  RUNNING` or `active (running)`. */
  detail: string;
  pid: number | null;
  checkedAt: string;
}

export type ProblemSeverity = "failed" | "degraded" | "warning";

export interface ProblemTarget {
  kind: "agent" | "fleet" | "component" | "unit" | "collector" | "service" | "connection";
  /** Component id, `componentId/unitId`, or collector node path. */
  id?: string;
}

export interface Problem {
  /** Stable across updates, so the UI can key on it. */
  id: string;
  severity: ProblemSeverity;
  title: string;
  /**
   * A recent message for the problem. Kept steady (refreshed at most once a minute) because the agent's
   * messages churn, e.g. a degraded unit cycling through metricset names several times a second.
   */
  detail: string;
  target: ProblemTarget;
  /** When the bridge first saw this problem (continuously) present. */
  since: string;
}

export interface Snapshot {
  connection: Connection;
  agent: AgentInfo | null;
  upgrade: UpgradeInfo | null;
  components: Component[];
  collector: CollectorNode | null;
  policy: PolicyInfo | null;
  service: ServiceInfo | null;
  problems: Problem[];
  /** History is only recorded while the bridge runs; this is when it started. */
  historySince: string;
  updatedAt: string;
}

export interface Transition {
  at: string;
  /** `agent`, `fleet`, a component id, or `componentId/unitId`. */
  target: string;
  kind: "agent" | "fleet" | "component" | "unit";
  from: AgentState | null;
  to: AgentState | null;
  message: string;
}

/** In increasing severity. */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number] | "unknown";

export interface LogFilter {
  /** Minimum level, e.g. `warn` matches warn, error, and fatal. */
  minLevel?: LogLevel;
  /** Component id; `agent` for the agent's own entries. */
  component?: string;
  /** Case-insensitive substring match on the message. */
  q?: string;
  /** Include the collector telemetry dumps. */
  telemetry?: boolean;
}

/** Shared by the bridge (queries) and the web app (filtering live entries), so both agree on what matches. */
export function matchesLog(e: LogEntry, f: LogFilter): boolean {
  if (!f.telemetry && e.telemetry) return false;
  if (f.minLevel && levelRank(e.level) < levelRank(f.minLevel)) return false;
  if (f.component && (e.component ?? "agent") !== f.component) return false;
  if (f.q && !e.message.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

function levelRank(level: LogLevel): number {
  return (LOG_LEVELS as readonly string[]).indexOf(level);
}

export interface LogEntry {
  /** Monotonic per bridge run; use for paging and de-duplication. */
  seq: number;
  ts: string;
  level: LogLevel;
  /** `component.id`, or null for the agent itself. */
  component: string | null;
  logger: string | null;
  message: string;
  /** Periodic collector telemetry dumps. Huge and noisy; the UI hides them by default. */
  telemetry: boolean;
  /** All other fields from the NDJSON line, or null when the line was too large to keep. */
  fields: Record<string, unknown> | null;
  bytes: number;
}

export interface LogsResponse {
  entries: LogEntry[];
  /** The directory being tailed. */
  source: string | null;
  /** True if older entries exist beyond what the bridge keeps in memory. */
  truncated: boolean;
}

export interface TransitionsResponse {
  transitions: Transition[];
  historySince: string;
}

/** Server-sent events on `/api/v1/events`. */
export type BridgeEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "transitions"; transitions: Transition[] }
  | { type: "logs"; entries: LogEntry[] };

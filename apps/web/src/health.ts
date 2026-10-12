import type { Component, ConnectionStatus, Health, LogLevel, ProblemSeverity } from "@eaui/shared";

/** One palette for health everywhere: badges, dots, Problems bar. Values are EUI color names. */
export const HEALTH_COLOR: Record<Health, string> = {
  healthy: "success",
  starting: "primary",
  degraded: "warning",
  failed: "danger",
  unreachable: "danger",
  stopped: "subdued",
  updating: "accent",
};

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: "Healthy",
  starting: "Starting",
  degraded: "Degraded",
  failed: "Failed",
  unreachable: "Unreachable",
  stopped: "Stopped",
  updating: "Updating",
};

export const SEVERITY_COLOR: Record<ProblemSeverity, "danger" | "warning" | "primary"> = {
  failed: "danger",
  degraded: "warning",
  warning: "primary",
};

export const CONNECTION_HEALTH: Record<ConnectionStatus, Health> = {
  connected: "healthy",
  connecting: "starting",
  unreachable: "unreachable",
  unsupported: "failed",
};

export const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: "hollow",
  debug: "hollow",
  info: "default",
  warn: "warning",
  error: "danger",
  fatal: "danger",
  unknown: "hollow",
};

/** An EUI icon for a component, from its input type (the part of the name before any `/`). */
export function componentIcon(c: Component): string {
  const type = c.name.split("/")[0]!;
  if (type === "elasticsearch") return "logoElasticsearch";
  if (c.name.endsWith("/metrics") || type === "system") return "metricsApp";
  if (["log", "filestream", "winlog", "journald"].includes(type)) return "logsApp";
  if (["httpjson", "cel", "http_endpoint"].includes(type)) return "plugs";
  if (type === "endpoint") return "securityApp";
  if (type === "osquery") return "logoOsquery";
  return "package";
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour12: false });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { hour12: false });
}

export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

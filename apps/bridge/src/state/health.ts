import type { CollectorNode, Health, Problem, Snapshot } from "@eaui/shared";

export function collectorHealth(status: string): Health {
  switch (status) {
    case "StatusOK":
      return "healthy";
    case "StatusNone":
    case "StatusStarting":
      return "starting";
    case "StatusRecoverableError":
      return "degraded";
    case "StatusPermanentError":
    case "StatusFatalError":
      return "failed";
    case "StatusStopping":
    case "StatusStopped":
      return "stopped";
    default:
      return "degraded";
  }
}

const SEVERITY: Partial<Record<Health, Problem["severity"]>> = {
  failed: "failed",
  unreachable: "failed",
  degraded: "degraded",
  stopped: "warning",
  updating: "warning",
};

/** A problem before the store adds `since` and steadies `detail`. */
export type RawProblem = Omit<Problem, "since">;

/**
 * Everything currently not healthy, most specific first: a degraded unit is reported as itself rather than
 * as "agent degraded" + "component degraded" + "unit degraded".
 */
export function computeProblems(s: Omit<Snapshot, "problems">): RawProblem[] {
  const problems: RawProblem[] = [];

  if (s.connection.status === "unreachable") {
    problems.push({
      id: "connection",
      severity: "failed",
      title: "Can't reach the agent's control socket",
      detail: s.connection.error ?? s.connection.socket,
      target: { kind: "connection" },
    });
  }
  if (s.connection.status === "unsupported") {
    problems.push({
      id: "connection",
      severity: "failed",
      title: "Unsupported Elastic Agent version",
      detail: s.connection.error ?? "",
      target: { kind: "connection" },
    });
  }
  if (s.service && s.service.state !== "running" && s.service.state !== "unknown") {
    problems.push({
      id: "service",
      severity: s.service.state === "stopped" ? "failed" : "warning",
      title: `Service ${s.service.name} is ${s.service.state}`,
      detail: s.service.detail,
      target: { kind: "service" },
    });
  }

  if (s.connection.status === "connected" && s.agent) {
    let componentProblem = false;
    for (const c of s.components) {
      const unitProblems = c.units.filter((u) => SEVERITY[u.health]);
      for (const u of unitProblems) {
        problems.push({
          id: `unit:${c.id}/${u.id}`,
          severity: SEVERITY[u.health]!,
          title: `${c.name} ${u.type} ${u.state.toLowerCase()}`,
          detail: u.message,
          target: { kind: "unit", id: `${c.id}/${u.id}` },
        });
      }
      if (SEVERITY[c.health] && unitProblems.length === 0) {
        problems.push({
          id: `component:${c.id}`,
          severity: SEVERITY[c.health]!,
          title: `${c.name} ${c.state.toLowerCase()}`,
          detail: c.message,
          target: { kind: "component", id: c.id },
        });
      }
      componentProblem ||= unitProblems.length > 0 || Boolean(SEVERITY[c.health]);
    }

    // Collector nodes that aren't already reported through a component, e.g. OTel config defined directly in the
    // policy. Agent-managed components show up in the collector tree under `_agent-component/<id>`.
    for (const node of collectorProblemNodes(s.collector)) {
      if (node.path.includes("_agent-component")) continue;
      problems.push({
        id: `collector:${node.path}`,
        severity: SEVERITY[node.health] ?? "degraded",
        title: `Collector ${node.path} ${node.status.replace(/^Status/, "")}`,
        detail: node.error,
        target: { kind: "collector", id: node.path },
      });
    }

    if (SEVERITY[s.agent.health] && !componentProblem) {
      problems.push({
        id: "agent",
        severity: SEVERITY[s.agent.health]!,
        title: `Agent ${s.agent.state.toLowerCase()}`,
        detail: s.agent.message,
        target: { kind: "agent" },
      });
    }
    if (s.agent.isManaged && SEVERITY[s.agent.fleetHealth]) {
      problems.push({
        id: "fleet",
        severity: SEVERITY[s.agent.fleetHealth]!,
        title: `Fleet connection ${s.agent.fleetState.toLowerCase()}`,
        detail: s.agent.fleetMessage,
        target: { kind: "fleet" },
      });
    }
  }

  const rank = { failed: 0, degraded: 1, warning: 2 } as const;
  return problems.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

/** Leaf-most unhealthy collector nodes, so a broken receiver isn't also reported as a broken pipeline and collector. */
function collectorProblemNodes(root: CollectorNode | null): (CollectorNode & { path: string })[] {
  const out: (CollectorNode & { path: string })[] = [];
  const visit = (node: CollectorNode, path: string): boolean => {
    let childReported = false;
    for (const child of node.children) childReported = visit(child, path ? `${path}/${child.id}` : child.id) || childReported;
    if (!childReported && SEVERITY[node.health] && path) {
      out.push({ ...node, path });
      return true;
    }
    return childReported;
  };
  if (root) visit(root, "");
  return out;
}

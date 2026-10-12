import { EventEmitter } from "node:events";
import type { AgentState, Connection, ConnectionStatus, PolicyInfo, Problem, ServiceInfo, Snapshot, Transition } from "@eaui/shared";
import type { AgentStatus } from "../agent/normalize.ts";
import { computeProblems, type RawProblem } from "./health.ts";

const THROTTLE_MS = 1_000;
const DETAIL_HOLD_MS = 60_000;
const MAX_TRANSITIONS = 2_000;

type Tracked = { kind: Transition["kind"]; state: AgentState; message: string };

/**
 * Holds the current picture of the agent and turns the raw update stream into something the UI can use:
 * - records a Transition only when a state actually changes (StateWatch sends ~4 updates/s of message churn);
 * - emits `snapshot` at most once per second, except state changes, which go out immediately;
 * - emits `componentsChanged` when the set of components changes (a hint that the policy changed).
 */
export class AgentStore extends EventEmitter<{
  snapshot: [Snapshot];
  transitions: [Transition[]];
  componentsChanged: [];
}> {
  readonly historySince = new Date().toISOString();
  private connection: Connection;
  private status: AgentStatus = { agent: null, upgrade: null, components: [], collector: null };
  private policy: PolicyInfo | null = null;
  private service: ServiceInfo | null = null;
  private readonly transitions: Transition[] = [];
  private tracked = new Map<string, Tracked>();
  private componentKey = "";
  private lastEmit = 0;
  private timer: NodeJS.Timeout | null = null;
  private current: Snapshot;
  private problemState = new Map<string, { since: string; detail: string; detailAt: number }>();

  constructor(socket: string) {
    super();
    this.connection = { status: "connecting", socket, error: null, since: this.historySince };
    this.current = this.build();
  }

  snapshot(): Snapshot {
    return this.current;
  }

  recentTransitions(limit = 200): Transition[] {
    return this.transitions.slice(-limit);
  }

  setConnection(status: ConnectionStatus, error: string | null) {
    const changed = status !== this.connection.status;
    this.connection = { ...this.connection, status, error, since: changed ? new Date().toISOString() : this.connection.since };
    this.update(changed);
  }

  setStatus(status: AgentStatus) {
    this.status = status;
    const transitions = this.diff(status);
    if (transitions.length) {
      this.transitions.push(...transitions);
      if (this.transitions.length > MAX_TRANSITIONS) this.transitions.splice(0, this.transitions.length - MAX_TRANSITIONS);
      this.emit("transitions", transitions);
    }
    const key = status.components.map((c) => c.id).join("\n");
    if (key !== this.componentKey) {
      const first = this.componentKey === "";
      this.componentKey = key;
      if (!first) this.emit("componentsChanged");
    }
    this.update(transitions.length > 0);
  }

  setPolicy(policy: PolicyInfo) {
    this.policy = policy;
    this.update(true);
  }

  setService(service: ServiceInfo) {
    const changed = service.state !== this.service?.state;
    this.service = service;
    this.update(changed);
  }

  private diff(status: AgentStatus): Transition[] {
    const next = new Map<string, Tracked>();
    if (status.agent) {
      next.set("agent", { kind: "agent", state: status.agent.state, message: status.agent.message });
      if (status.agent.isManaged) next.set("fleet", { kind: "fleet", state: status.agent.fleetState, message: status.agent.fleetMessage });
    }
    for (const c of status.components) {
      next.set(c.id, { kind: "component", state: c.state, message: c.message });
      for (const u of c.units) next.set(`${c.id}/${u.id}`, { kind: "unit", state: u.state, message: u.message });
    }

    // The first status after startup is the baseline, not a set of changes.
    if (this.tracked.size === 0) {
      this.tracked = next;
      return [];
    }

    const at = new Date().toISOString();
    const out: Transition[] = [];
    for (const [target, cur] of next) {
      const prev = this.tracked.get(target);
      if (!prev || prev.state !== cur.state) {
        out.push({ at, target, kind: cur.kind, from: prev?.state ?? null, to: cur.state, message: cur.message });
      }
    }
    for (const [target, prev] of this.tracked) {
      if (!next.has(target)) out.push({ at, target, kind: prev.kind, from: prev.state, to: null, message: "Removed" });
    }
    this.tracked = next;
    return out;
  }

  private update(immediate: boolean) {
    if (immediate || Date.now() - this.lastEmit >= THROTTLE_MS) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), THROTTLE_MS - (Date.now() - this.lastEmit));
    }
  }

  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastEmit = Date.now();
    this.current = this.build();
    this.emit("snapshot", this.current);
  }

  private build(): Snapshot {
    const base = {
      connection: this.connection,
      ...this.status,
      policy: this.policy,
      service: this.service,
      historySince: this.historySince,
      updatedAt: new Date().toISOString(),
    };
    return { ...base, problems: this.steadyProblems(computeProblems(base)) };
  }

  /**
   * Adds `since` and holds each problem's detail text for up to a minute. Without this the Problems bar
   * rewrites itself several times a second as the agent's messages churn.
   */
  private steadyProblems(raw: RawProblem[]): Problem[] {
    const now = Date.now();
    const seen = new Set<string>();
    const out = raw.map((p) => {
      seen.add(p.id);
      let held = this.problemState.get(p.id);
      if (!held) {
        held = { since: new Date(now).toISOString(), detail: p.detail, detailAt: now };
        this.problemState.set(p.id, held);
      } else if (held.detail !== p.detail && now - held.detailAt >= DETAIL_HOLD_MS) {
        held.detail = p.detail;
        held.detailAt = now;
      }
      return { ...p, detail: held.detail, since: held.since };
    });
    for (const id of this.problemState.keys()) if (!seen.has(id)) this.problemState.delete(id);
    return out;
  }
}

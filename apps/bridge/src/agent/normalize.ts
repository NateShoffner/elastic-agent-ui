import {
  CollectorComponentStatusSchema,
  StateSchema,
  UnitType as ProtoUnitType,
  type CollectorComponent,
  type StateResponse,
} from "@eaui/control-proto";
import type { AgentInfo, AgentState, CollectorNode, Component, ComponentRuntime, Unit, UpgradeInfo } from "@eaui/shared";
import { stateHealth } from "@eaui/shared";
import { collectorHealth } from "../state/health.ts";

export interface AgentStatus {
  agent: AgentInfo | null;
  upgrade: UpgradeInfo | null;
  components: Component[];
  collector: CollectorNode | null;
}

export function stateName(n: number): AgentState {
  return (StateSchema.values.find((v) => v.number === n)?.name ?? "STARTING") as AgentState;
}

/**
 * Converts a StateResponse into the UI's model. Output is deterministic: components and units are sorted,
 * because the agent doesn't keep unit order stable between updates.
 */
export function normalizeState(res: StateResponse): AgentStatus {
  const state = stateName(res.state);
  const fleetState = stateName(res.fleetState);
  const agent: AgentInfo | null = res.info
    ? {
        id: res.info.id,
        version: res.info.version,
        commit: res.info.commit,
        buildTime: res.info.buildTime,
        snapshot: res.info.snapshot,
        pid: res.info.pid,
        unprivileged: res.info.unprivileged,
        isManaged: res.info.isManaged,
        state,
        health: stateHealth(state),
        message: res.message,
        fleetState,
        fleetHealth: res.info.isManaged ? stateHealth(fleetState) : "healthy",
        fleetMessage: res.fleetMessage,
      }
    : null;

  const upgrade: UpgradeInfo | null = res.upgradeDetails
    ? {
        targetVersion: res.upgradeDetails.targetVersion,
        state: res.upgradeDetails.state,
        actionId: res.upgradeDetails.actionId,
        errorMsg: res.upgradeDetails.metadata?.errorMsg || null,
      }
    : null;

  const components: Component[] = res.components
    .map((c) => {
      const compState = stateName(c.state);
      const units: Unit[] = c.units
        .map((u) => {
          const unitState = stateName(u.state);
          return {
            id: u.unitId,
            type: u.unitType === ProtoUnitType.OUTPUT ? ("output" as const) : ("input" as const),
            state: unitState,
            health: stateHealth(unitState),
            message: u.message,
            payload: parsePayload(u.payload),
          };
        })
        .sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type === "input" ? -1 : 1));
      return {
        id: c.id,
        name: c.name,
        state: compState,
        health: stateHealth(compState),
        message: c.message,
        runtime: runtimeOf(c.versionInfo?.name),
        pid: pidFrom(c.message),
        versionInfo: c.versionInfo ? { name: c.versionInfo.name, meta: { ...c.versionInfo.meta } } : null,
        units,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    agent,
    upgrade,
    components,
    collector: res.collector ? collectorNode("collector", res.collector) : null,
  };
}

function runtimeOf(versionName: string | undefined): ComponentRuntime {
  if (versionName === "beat-v2-client") return "process";
  if (versionName === "beats-receiver") return "otel";
  return "unknown";
}

/** Process components report "Healthy: communicating with pid '4242'"; that's the only place the PID shows up. */
function pidFrom(message: string): number | null {
  const m = /pid '(\d+)'/.exec(message);
  return m ? Number(m[1]) : null;
}

function parsePayload(payload: string): unknown {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function collectorNode(id: string, c: CollectorComponent): CollectorNode {
  const status = CollectorComponentStatusSchema.values.find((v) => v.number === c.status)?.name ?? String(c.status);
  return {
    id,
    status,
    health: collectorHealth(status),
    error: c.error,
    timestamp: c.timestamp,
    children: Object.entries(c.ComponentStatusMap)
      .map(([childId, child]) => collectorNode(childId, child))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

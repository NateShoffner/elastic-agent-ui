import { create } from "@bufbuild/protobuf";
import {
  CollectorComponentStatus,
  State,
  StateResponseSchema,
  UnitType,
  type StateResponse,
} from "@eaui/control-proto";

/**
 * A simulated agent modelled on a real 9.4.4 Fleet-managed install: a mix of process (beat-v2-client) and
 * in-collector (beats-receiver) components, one integration permanently degraded with churning messages,
 * and one input that periodically flaps.
 */
export const AGENT_ID = "00000000-mock-4000-8000-000000000001";
export const POLICY_ID = "11111111-mock-4000-8000-000000000002";
export const VERSION = "9.4.4";

const ES_METRICSETS = ["index", "index_recovery", "shard", "node_stats", "ml_job", "enrich", "ccr", "cluster_stats", "pending_tasks", "security_stats"];
const esError = (i: number) =>
  `Error fetching data for metricset elasticsearch.${ES_METRICSETS[i % ES_METRICSETS.length]}: error making http request: Get "http://localhost:9200/_nodes/_local/nodes": EOF`;

const meta = { commit: "mock0000", build_time: "2026-07-15 12:28:11 +0000 UTC" };

interface Sim {
  tick: number;
  httpjsonDown: boolean;
}

export function buildState(sim: Sim): StateResponse {
  const unit = (type: UnitType, id: string, state: State, message: string, payload = "") => ({ unitType: type, unitId: id, state, message, payload });
  const streams = (n: number) => JSON.stringify({ streams: Object.fromEntries(Array.from({ length: n }, (_, i) => [`stream-${i}`, { status: "HEALTHY" }])) });

  const components = [
    {
      id: "log-default",
      name: "log",
      state: State.HEALTHY,
      message: "Healthy: communicating with pid '4242'",
      versionInfo: { name: "beat-v2-client", meta },
      units: [
        unit(UnitType.INPUT, "log-default-logfile-elasticsearch-mock", State.HEALTHY, "Healthy", streams(6)),
        unit(UnitType.OUTPUT, "log-default", State.HEALTHY, "Healthy"),
      ],
    },
    {
      id: "elasticsearch/metrics-default",
      name: "elasticsearch/metrics",
      state: State.DEGRADED,
      message: `Recoverable: ${esError(sim.tick)}`,
      versionInfo: { name: "beats-receiver", meta },
      units: [
        unit(UnitType.INPUT, "elasticsearch/metrics-default-elasticsearch/metrics-elasticsearch-mock", State.DEGRADED, `Recoverable: ${esError(sim.tick + 3)}`, streams(13)),
        unit(UnitType.OUTPUT, "elasticsearch/metrics-default", State.HEALTHY, "Healthy"),
      ],
    },
    {
      id: "httpjson-default",
      name: "httpjson",
      state: sim.httpjsonDown ? State.DEGRADED : State.HEALTHY,
      message: sim.httpjsonDown ? "Degraded: 1 unit degraded" : "Healthy: communicating with pid '4243'",
      versionInfo: { name: "beat-v2-client", meta },
      units: [
        unit(
          UnitType.INPUT,
          "httpjson-default-httpjson-generic-mock",
          sim.httpjsonDown ? State.DEGRADED : State.HEALTHY,
          sim.httpjsonDown ? "Error while processing http request: server responded with status code 503" : "Healthy",
          streams(1),
        ),
        unit(UnitType.OUTPUT, "httpjson-default", State.HEALTHY, "Healthy"),
      ],
    },
    ...["beat/metrics-monitoring", "http/metrics-monitoring", "filestream-monitoring"].map((id) => ({
      id,
      name: id.replace(/-monitoring$/, ""),
      state: State.HEALTHY,
      message: "Healthy",
      versionInfo: { name: "beats-receiver", meta },
      units: [
        unit(UnitType.INPUT, `${id}-${id.split("/")[0]}-monitoring-agent`, State.HEALTHY, "Healthy", streams(1)),
        unit(UnitType.OUTPUT, id, State.HEALTHY, "Healthy"),
      ],
    })),
  ];
  // The real agent doesn't keep unit order stable; neither do we.
  if (sim.tick % 2) for (const c of components) c.units.reverse();

  const ok = { status: CollectorComponentStatus.StatusOK, error: "", timestamp: new Date().toISOString(), ComponentStatusMap: {} };
  const degradedErr = esError(sim.tick);

  return create(StateResponseSchema, {
    info: { id: AGENT_ID, version: VERSION, commit: "mock0000", buildTime: "2026-07-15T12:28:11Z", snapshot: false, pid: process.pid, unprivileged: false, isManaged: true },
    state: State.DEGRADED,
    message: "1 or more components/units in a degraded state",
    fleetState: State.HEALTHY,
    fleetMessage: "Connected",
    components,
    collector: {
      status: CollectorComponentStatus.StatusRecoverableError,
      error: degradedErr,
      timestamp: new Date().toISOString(),
      ComponentStatusMap: {
        "pipeline:logs/default": ok,
        "pipeline:logs/otelcol-example_app-events": {
          ...ok,
          ComponentStatusMap: {
            "receiver:otlp/example_app": ok,
            "exporter:elasticsearch/example_app": ok,
          },
        },
        "pipeline:metrics/_agent-component/elasticsearch/metrics-default": {
          status: CollectorComponentStatus.StatusRecoverableError,
          error: degradedErr,
          timestamp: new Date().toISOString(),
          ComponentStatusMap: {
            "receiver:metricbeatreceiver/_agent-component/elasticsearch/metrics-default": {
              status: CollectorComponentStatus.StatusRecoverableError,
              error: degradedErr,
              timestamp: new Date().toISOString(),
              ComponentStatusMap: {},
            },
          },
        },
      },
    },
  });
}

export function createSim(): Sim {
  return { tick: 0, httpjsonDown: false };
}

/** Advances the simulation one step (called ~4x per second, like the real StateWatch churn). */
export function step(sim: Sim) {
  sim.tick++;
  // httpjson flaps: degraded for ~10s out of every ~40s.
  const phase = sim.tick % 160;
  sim.httpjsonDown = phase >= 120;
}

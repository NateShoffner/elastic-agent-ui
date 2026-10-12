import { appendFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * Writes agent-style NDJSON: component logs with `component.*` fields, metricset errors from the degraded
 * integration, periodic "Non-zero metrics" lines, and the huge collector telemetry dumps.
 * Rotates like the agent: a new `-N` suffixed file rather than truncating.
 */
export function startLogWriter(dir: string, sim: { tick: number; httpjsonDown: boolean }) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const existing = readdirSync(dir).filter((f) => f.startsWith(`elastic-agent-${day}`)).length;
  let index = existing;
  let file = fileName(dir, day, index);

  const write = (entry: Record<string, unknown>) => {
    appendFileSync(file, JSON.stringify({ "log.level": "info", "@timestamp": new Date().toISOString(), ...entry, "ecs.version": "1.6.0" }) + "\n");
    try {
      if (statSync(file).size > ROTATE_BYTES) file = fileName(dir, day, ++index);
    } catch {}
  };

  const component = (id: string, binary: string, type: string) => ({
    "component.id": id,
    "component.binary": binary,
    "component.type": type,
    "component.dataset": `elastic_agent.${binary}`,
    "log.source": id,
    "log.logger": binary === "metricbeat" ? "metricbeat.receiver" : "input",
    "service.name": binary,
  });

  write({ message: "Mock agent started", "log.logger": "elastic-agent" });

  let n = 0;
  setInterval(() => {
    n++;
    // The degraded elasticsearch integration: one metricset error per second.
    write({
      ...component("elasticsearch/metrics-default", "metricbeat", "elasticsearch/metrics"),
      "log.level": "error",
      message: `Error fetching data for metricset elasticsearch.${["index", "shard", "node_stats", "ml_job", "enrich"][n % 5]}: error making http request: Get "http://localhost:9200/_nodes/_local/nodes": EOF`,
      "otelcol.component.id": "metricbeatreceiver/_agent-component/elasticsearch/metrics-default",
      "otelcol.component.kind": "receiver",
      "otelcol.signal": "logs",
    });

    if (n % 5 === 0) {
      write({
        ...component("httpjson-default", "filebeat", "httpjson"),
        "log.level": sim.httpjsonDown ? "error" : "info",
        message: sim.httpjsonDown ? "Error while processing http request: server responded with status code 503" : `request finished: ${n % 7} events published`,
        input_url: "https://api.example.com/v1/facts",
      });
    }

    if (n % 30 === 0) {
      for (const [id, binary, type] of [
        ["log-default", "filebeat", "log"],
        ["httpjson-default", "filebeat", "httpjson"],
        ["filestream-monitoring", "filebeat", "filestream"],
      ] as const) {
        write({
          ...component(id, binary, type),
          message: "Non-zero metrics in the last 30s",
          "monitoring.metrics": { libbeat: { pipeline: { events: { published: n % 50, total: n % 50 } } } },
        });
      }
    }

    if (n % 30 === 15) {
      // ~40 KB, like the real collector telemetry dumps.
      write({
        "log.logger": "elastic-agent.otel",
        message: "Collector internal telemetry metrics updated",
        metrics: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`otelcol_metric_${i}`, { value: i * n, labels: { receiver: `r${i % 7}`, pipeline: "logs/default" } }])),
      });
    }

    if (n % 120 === 60) write({ "log.level": "warn", "log.logger": "elastic-agent.fleet", message: "Fleet checkin took longer than expected: 4.2s" });
  }, 1_000);
}

function fileName(dir: string, day: string, index: number): string {
  return path.join(dir, index === 0 ? `elastic-agent-${day}.ndjson` : `elastic-agent-${day}-${index}.ndjson`);
}

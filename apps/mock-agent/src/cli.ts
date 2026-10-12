/**
 * Stand-in for the `elastic-agent` CLI, for the commands the bridge shells out to.
 * Usage: node apps/mock-agent/src/cli.ts inspect
 */
import { AGENT_ID, POLICY_ID } from "./scenario.ts";

const [cmd] = process.argv.slice(2);

if (cmd === "inspect") {
  // Real inspect takes ~8s; a little delay keeps the UI's loading state honest.
  await new Promise((r) => setTimeout(r, 1_500));
  process.stdout.write(`agent:
  id: ${AGENT_ID}
  logging:
    level: info
  monitoring:
    enabled: true
    logs: true
    metrics: true
fleet:
  hosts:
    - https://mock-fleet.example.com:443
id: ${POLICY_ID}
revision: 59
outputs:
  default:
    type: elasticsearch
    hosts: ["https://mock-es.example.com:443"]
    api_key: "[redacted in real output too, hopefully]"
inputs:
  - id: httpjson-generic-mock
    type: httpjson
    name: example-api
    use_output: default
    meta:
      package:
        name: httpjson
    streams:
      - id: s1
  - id: logfile-elasticsearch-mock
    type: logfile
    name: elasticsearch-1
    use_output: default
    meta:
      package:
        name: elasticsearch
    streams: [{ id: a }, { id: b }, { id: c }, { id: d }, { id: e }, { id: f }]
  - id: elasticsearch/metrics-elasticsearch-mock
    type: elasticsearch/metrics
    name: elasticsearch-1
    use_output: default
    meta:
      package:
        name: elasticsearch
    streams: [{ id: a }, { id: b }, { id: c }]
`);
} else {
  console.error(`mock elastic-agent: unsupported command: ${process.argv.slice(2).join(" ")}`);
  process.exit(1);
}

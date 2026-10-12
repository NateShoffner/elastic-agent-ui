# Elastic Agent UI

A local web UI for watching and controlling the Elastic Agent on this machine. Supports Agent 9.x on Windows, Linux, and macOS.

## Run

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm build
pnpm start
```

`pnpm start` asks for admin rights (UAC or sudo), because the agent only talks to administrators, then opens the UI in your browser.

## Develop

```sh
pnpm dev:mock
```

Runs the UI against a fake agent, so you don't need admin rights or a real install.

## Caveats

- **Local only.** The UI reads the agent's local control socket, CLI, and log files. It never talks to Fleet, Kibana, or Elasticsearch. Fleet-managed settings (log level, inputs, policy, upgrades) have to be changed in Fleet.
- **History starts when the UI starts.** The agent only reports its current state, and it doesn't log state changes at the default level, so there's no earlier history to rebuild.
- **The control API uses Connect, not grpc-js.** grpc-js times out on the Windows named pipe; `@connectrpc/connect-node` works over both named pipes and Unix sockets.
- **The agent's state stream is noisy.** It sends several updates per second, mostly message churn. The bridge records only real state changes and holds problem messages steady for up to a minute.
- **Logs are read from one directory.** The agent can write every entry twice (install dir and `data/elastic-agent-*/logs`). The large "collector telemetry" lines are hidden by default.
- **`elastic-agent inspect` is slow** (several seconds), so the policy summary is cached and refreshed when components change.
- **Only verified on Windows so far.** Linux and macOS support is written but untested.

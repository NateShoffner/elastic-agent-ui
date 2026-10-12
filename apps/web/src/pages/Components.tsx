import { EuiBadge, EuiBasicTable, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiSpacer, EuiText, EuiTitle, EuiToolTip, type EuiBasicTableColumn } from "@elastic/eui";
import { useSearchParams } from "react-router";
import type { CollectorNode, Component, Snapshot } from "@eaui/shared";
import { ComponentFlyout, RUNTIME_LABEL } from "../components/ComponentFlyout";
import { HealthDot } from "../components/HealthBadge";
import { componentIcon } from "../health";

export function Components({ snapshot }: { snapshot: Snapshot }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("c");
  const selected = snapshot.components.find((c) => c.id === selectedId) ?? null;
  const connected = snapshot.connection.status === "connected";

  const columns: EuiBasicTableColumn<Component>[] = [
    { field: "health", name: "Health", width: "120px", render: (_: unknown, c: Component) => <HealthDot health={connected ? c.health : "unreachable"} /> },
    {
      field: "name",
      name: "Component",
      render: (_: unknown, c: Component) => (
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiIcon type={componentIcon(c)} size="m" />
          </EuiFlexItem>
          <EuiFlexItem>
            <strong>{c.name}</strong>
            <EuiText size="xs" color="subdued">
              {c.id}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      ),
    },
    {
      field: "runtime",
      name: "Runtime",
      width: "150px",
      render: (_: unknown, c: Component) => (
        <EuiToolTip content={c.versionInfo?.name}>
          <EuiBadge color="hollow">{RUNTIME_LABEL[c.runtime]}</EuiBadge>
        </EuiToolTip>
      ),
    },
    { field: "pid", name: "PID", width: "80px", render: (pid: number | null) => pid ?? "—" },
    {
      field: "units",
      name: "Units",
      width: "200px",
      render: (_: unknown, c: Component) => (
        <EuiFlexGroup gutterSize="s" wrap responsive={false}>
          {c.units.map((u) => (
            <EuiFlexItem grow={false} key={`${u.type}:${u.id}`}>
              <EuiToolTip content={`${u.id}: ${u.message || u.state}`}>
                <HealthDot health={u.health}>{u.type}</HealthDot>
              </EuiToolTip>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      ),
    },
    { field: "message", name: "Message", render: (m: string) => <span style={{ wordBreak: "break-word" }}>{m}</span> },
  ];

  return (
    <>
      <EuiBasicTable<Component>
        items={snapshot.components}
        columns={columns}
        rowProps={(c) => ({
          onClick: () => setParams({ c: c.id }),
          style: { cursor: "pointer" },
          isSelected: c.id === selectedId,
        })}
        noItemsMessage={connected ? "The agent reports no components." : "Waiting for the agent…"}
      />

      {snapshot.collector && (
        <>
          <EuiSpacer size="l" />
          <EuiTitle size="xs">
            <h2 id="collector">EDOT collector</h2>
          </EuiTitle>
          <EuiText size="xs" color="subdued">
            Pipelines, receivers, and exporters running inside the collector, including OTel configuration defined directly in the policy.
          </EuiText>
          <EuiSpacer size="s" />
          <CollectorTree node={snapshot.collector} depth={0} />
        </>
      )}

      {selected && <ComponentFlyout key={selected.id} component={selected} connected={connected} onClose={() => setParams({})} />}
    </>
  );
}

function CollectorTree({ node, depth }: { node: CollectorNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 20, marginBottom: 4 }}>
      <HealthDot health={node.health}>
        <span>
          <code>{depth === 0 ? "collector" : node.id}</code>{" "}
          <EuiText size="xs" color="subdued" component="span">
            {node.status.replace(/^Status/, "")}
          </EuiText>
        </span>
      </HealthDot>
      {node.error && (
        <EuiText size="xs" color="warning" style={{ marginLeft: 20, wordBreak: "break-word" }}>
          {node.error}
        </EuiText>
      )}
      {node.children.map((child) => (
        <CollectorTree key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

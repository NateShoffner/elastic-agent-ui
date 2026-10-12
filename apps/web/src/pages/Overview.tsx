import {
  EuiBasicTable,
  EuiButtonIcon,
  EuiCopy,
  EuiDescriptionList,
  EuiFlexGrid,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  type EuiBasicTableColumn,
} from "@elastic/eui";
import { useNavigate } from "react-router";
import type { Snapshot, Transition } from "@eaui/shared";
import { useTransitions } from "../api";
import { HealthBadge, HealthDot } from "../components/HealthBadge";
import { TransitionState } from "../components/TransitionState";
import { componentIcon, formatTime, relativeTime } from "../health";

export function Overview({ snapshot }: { snapshot: Snapshot }) {
  const navigate = useNavigate();
  const { agent, policy, service, connection } = snapshot;
  const connected = connection.status === "connected";

  return (
    <>
      <EuiFlexGrid columns={4} gutterSize="m">
        <SummaryPanel title="Agent" icon="agentApp">
          {agent ? (
            <>
              <HealthBadge health={connected ? agent.health : "unreachable"} />
              <EuiSpacer size="s" />
              <EuiDescriptionList
                compressed
                type="column"
                listItems={[
                  { title: "Version", description: `${agent.version}${agent.snapshot ? " (snapshot)" : ""}` },
                  { title: "Mode", description: `${agent.isManaged ? "Fleet-managed" : "Standalone"}${agent.unprivileged ? ", unprivileged" : ""}` },
                  { title: "PID", description: String(agent.pid) },
                ]}
              />
            </>
          ) : (
            <EuiText size="s" color="subdued">
              {connection.error ?? "Connecting…"}
            </EuiText>
          )}
        </SummaryPanel>

        <SummaryPanel title="Fleet" icon="fleetApp">
          {agent?.isManaged ? (
            <>
              <HealthBadge health={connected ? agent.fleetHealth : "unreachable"} />
              <EuiSpacer size="s" />
              <EuiText size="s">{agent.fleetMessage || "—"}</EuiText>
              {policy?.fleetHosts.map((host) => (
                <EuiFlexGroup key={host} gutterSize="xs" alignItems="center" responsive={false}>
                  <EuiFlexItem>
                    <EuiText size="xs" color="subdued" style={{ wordBreak: "break-all" }}>
                      {host}
                    </EuiText>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <CopyButton text={host} label="Copy Fleet Server URL" />
                  </EuiFlexItem>
                </EuiFlexGroup>
              ))}
            </>
          ) : (
            <EuiText size="s" color="subdued">
              {agent ? "Not enrolled (standalone)" : "—"}
            </EuiText>
          )}
        </SummaryPanel>

        <SummaryPanel title="Policy" icon="package">
          {policy?.error ? (
            <EuiText size="s" color="danger">
              {policy.error}
            </EuiText>
          ) : policy ? (
            <EuiDescriptionList
              compressed
              type="column"
              listItems={[
                { title: "Revision", description: policy.revision ?? "—" },
                { title: "Policy ID", description: <IdWithCopy id={policy.policyId} /> },
                { title: "Agent ID", description: <IdWithCopy id={policy.agentId ?? agent?.id ?? null} /> },
                { title: "Inputs", description: String(policy.inputs.length) },
                { title: "Log level", description: policy.logLevel ?? "—" },
              ]}
            />
          ) : (
            <EuiText size="s" color="subdued">
              Reading policy (elastic-agent inspect)…
            </EuiText>
          )}
        </SummaryPanel>

        <SummaryPanel title="Service" icon="gear">
          {service ? (
            <>
              <HealthBadge
                health={service.state === "running" ? "healthy" : service.state === "unknown" ? "degraded" : service.state === "stopped" ? "failed" : "starting"}
                label={service.state}
              />
              <EuiSpacer size="s" />
              <EuiDescriptionList
                compressed
                type="column"
                listItems={[
                  { title: "Name", description: service.name },
                  { title: "PID", description: service.pid ? String(service.pid) : "—" },
                  { title: "Checked", description: relativeTime(service.checkedAt) },
                ]}
              />
            </>
          ) : (
            <EuiText size="s" color="subdued">
              Checking…
            </EuiText>
          )}
        </SummaryPanel>
      </EuiFlexGrid>

      <EuiSpacer size="l" />
      <EuiTitle size="xs">
        <h2>Components</h2>
      </EuiTitle>
      <EuiSpacer size="s" />
      <EuiFlexGrid columns={3} gutterSize="s">
        {snapshot.components.map((c) => (
          <EuiFlexItem key={c.id}>
            <EuiPanel
              hasBorder
              paddingSize="s"
              onClick={() => navigate(`/components?c=${encodeURIComponent(c.id)}`)}
              style={{ opacity: connected ? 1 : 0.5 }}
            >
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiIcon type={componentIcon(c)} />
                </EuiFlexItem>
                <EuiFlexItem>
                  <HealthDot health={c.health}>
                    <strong>{c.name}</strong>
                  </HealthDot>
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiText size="xs" color="subdued">
                {c.id} · {c.units.length} units
              </EuiText>
            </EuiPanel>
          </EuiFlexItem>
        ))}
      </EuiFlexGrid>

      <EuiSpacer size="l" />
      <RecentChanges />
    </>
  );
}

function SummaryPanel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <EuiFlexItem>
      <EuiPanel hasBorder paddingSize="m">
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiIcon type={icon} />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="xs" color="subdued">
              <h3 style={{ margin: 0 }}>{title}</h3>
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        {children}
      </EuiPanel>
    </EuiFlexItem>
  );
}

function IdWithCopy({ id }: { id: string | null }) {
  if (!id) return <>—</>;
  return (
    <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>
        <code style={{ wordBreak: "break-all" }}>{id}</code>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <CopyButton text={id} label="Copy ID" />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <EuiCopy textToCopy={text} beforeMessage={label}>
      {(copy) => <EuiButtonIcon iconType="copy" size="xs" aria-label={label} onClick={copy} />}
    </EuiCopy>
  );
}

const transitionColumns: EuiBasicTableColumn<Transition>[] = [
  { field: "at", name: "Time", width: "100px", render: (at: string) => formatTime(at) },
  { field: "target", name: "What", render: (target: string, t: Transition) => `${t.kind === "unit" ? "unit " : ""}${target}` },
  { name: "Change", width: "260px", render: (t: Transition) => <TransitionState t={t} /> },
  { field: "message", name: "Message", render: (m: string) => <span style={{ wordBreak: "break-word" }}>{m}</span> },
];

function RecentChanges() {
  const { data } = useTransitions();
  const items = [...(data?.transitions ?? [])].reverse().slice(0, 20);
  return (
    <>
      <EuiFlexGroup alignItems="baseline" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h2>Recent state changes</h2>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {data ? `recorded since ${formatTime(data.historySince)} (history starts when the UI starts)` : ""}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiBasicTable items={items} columns={transitionColumns} noItemsMessage="No state changes since the UI started." compressed />
    </>
  );
}

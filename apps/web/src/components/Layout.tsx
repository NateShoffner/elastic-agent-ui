import { useState } from "react";
import {
  EuiBadge,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLink,
  EuiPageTemplate,
  EuiSideNav,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from "@elastic/eui";
import { useLocation, useNavigate } from "react-router";
import type { Problem, Snapshot } from "@eaui/shared";
import { CONNECTION_HEALTH, SEVERITY_COLOR, formatDateTime, formatTime } from "../health";
import { HealthBadge } from "./HealthBadge";

const NAV = [
  { path: "/", name: "Overview", icon: "home" },
  { path: "/components", name: "Components", icon: "apps" },
  { path: "/logs", name: "Logs", icon: "logsApp" },
];

export function Layout({ snapshot, streamOpen, children }: { snapshot: Snapshot; streamOpen: boolean; children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const agent = snapshot.agent;

  return (
    <EuiPageTemplate panelled restrictWidth={false} grow>
      <EuiPageTemplate.Sidebar sticky minWidth={200}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiIcon type="agentApp" size="l" />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiTitle size="xs">
              <h1>Elastic Agent</h1>
            </EuiTitle>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiText size="xs" color="subdued">
          {agent ? `v${agent.version}${agent.isManaged ? " · Fleet-managed" : " · standalone"}` : "—"}
        </EuiText>
        <EuiSpacer size="m" />
        <EuiSideNav
          items={[
            {
              id: "root",
              name: "",
              items: NAV.map((n) => ({
                id: n.path,
                name: n.name,
                icon: <EuiIcon type={n.icon} />,
                isSelected: n.path === "/" ? location.pathname === "/" : location.pathname.startsWith(n.path),
                onClick: () => navigate(n.path),
              })),
            },
          ]}
        />
      </EuiPageTemplate.Sidebar>

      <EuiPageTemplate.Header
        paddingSize="m"
        pageTitle={<AgentTitle snapshot={snapshot} />}
        rightSideItems={[
          <EuiFlexGroup key="status" gutterSize="s" alignItems="center" responsive={false}>
            {!streamOpen && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="warning">Live updates paused, reconnecting…</EuiBadge>
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false}>
              <HealthBadge health={CONNECTION_HEALTH[snapshot.connection.status]} label={`Socket: ${snapshot.connection.status}`} />
            </EuiFlexItem>
          </EuiFlexGroup>,
        ]}
      />

      {snapshot.problems.length > 0 && (
        <EuiPageTemplate.Section paddingSize="m" grow={false}>
          <ProblemsBar problems={snapshot.problems} snapshot={snapshot} />
        </EuiPageTemplate.Section>
      )}

      <EuiPageTemplate.Section paddingSize="m">{children}</EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}

function AgentTitle({ snapshot }: { snapshot: Snapshot }) {
  const agent = snapshot.agent;
  return (
    <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>{agent ? <HealthBadge health={snapshot.connection.status === "connected" ? agent.health : "unreachable"} /> : null}</EuiFlexItem>
      <EuiFlexItem grow={false}>
        <span>{agent?.message || (snapshot.connection.status === "connected" ? "Agent" : "Waiting for the agent")}</span>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}

const COLLAPSED_COUNT = 3;

function ProblemsBar({ problems, snapshot }: { problems: Problem[]; snapshot: Snapshot }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const worst = problems[0]!.severity;
  const shown = expanded ? problems : problems.slice(0, COLLAPSED_COUNT);

  return (
    <EuiCallOut
      color={SEVERITY_COLOR[worst]}
      iconType={worst === "failed" ? "error" : "warning"}
      size="s"
      title={`${problems.length} ${problems.length === 1 ? "problem" : "problems"}`}
    >
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
        {shown.map((p) => (
          <li key={p.id} style={{ marginBottom: 4 }}>
            <EuiLink onClick={() => navigate(problemLink(p, snapshot))}>
              <strong>{p.title}</strong>
            </EuiLink>{" "}
            <EuiText size="xs" color="subdued" component="span" title={formatDateTime(p.since)}>
              · since {formatTime(p.since)}
            </EuiText>
            {p.detail && (
              <EuiText size="xs" color="subdued" style={{ wordBreak: "break-word" }}>
                {p.detail}
              </EuiText>
            )}
          </li>
        ))}
      </ul>
      {problems.length > COLLAPSED_COUNT && (
        <EuiButtonEmpty size="xs" flush="left" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${problems.length}`}
        </EuiButtonEmpty>
      )}
    </EuiCallOut>
  );
}

/** Where a problem's link goes. Unit targets are `componentId/unitId`, and both ids can contain `/`. */
export function problemLink(p: Problem, snapshot: Snapshot): string {
  switch (p.target.kind) {
    case "component":
      return `/components?c=${encodeURIComponent(p.target.id ?? "")}`;
    case "unit": {
      const comp = snapshot.components.find((c) => p.target.id?.startsWith(`${c.id}/`));
      return comp ? `/components?c=${encodeURIComponent(comp.id)}` : "/components";
    }
    case "collector":
      return "/components#collector";
    default:
      return "/";
  }
}

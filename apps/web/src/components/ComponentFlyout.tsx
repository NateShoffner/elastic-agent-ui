import { useState } from "react";
import {
  EuiAccordion,
  EuiBadge,
  EuiBasicTable,
  EuiButtonEmpty,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from "@elastic/eui";
import { useNavigate } from "react-router";
import type { Component, Transition, Unit } from "@eaui/shared";
import { useLiveLogs, useTransitions } from "../api";
import { formatTime } from "../health";
import { HealthBadge, HealthDot } from "./HealthBadge";
import { LogList } from "./LogList";
import { TransitionState } from "./TransitionState";

export const RUNTIME_LABEL: Record<Component["runtime"], string> = {
  process: "Separate process",
  otel: "In EDOT collector",
  unknown: "Unknown runtime",
};

/**
 * Detail for one component. Cards start expanded when they have something wrong to show and collapsed
 * when everything's fine.
 */
export function ComponentFlyout({ component, connected, onClose }: { component: Component; connected: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const unhealthyUnits = component.units.filter((u) => u.health !== "healthy");
  const logs = useLiveLogs({ component: component.id }, { limit: 100 });
  const errors = logs.entries.filter((e) => e.level === "error" || e.level === "fatal").length;
  const warnings = logs.entries.filter((e) => e.level === "warn").length;
  const { data: transitions } = useTransitions();
  const own = (transitions?.transitions ?? []).filter((t) => t.target === component.id || t.target.startsWith(`${component.id}/`)).reverse();

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus={false} aria-labelledby="component-flyout-title">
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem grow={false}>
            <HealthBadge health={connected ? component.health : "unreachable"} />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiTitle size="s">
              <h2 id="component-flyout-title">{component.name}</h2>
            </EuiTitle>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiText size="xs" color="subdued">
          {component.id}
        </EuiText>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        {component.message && (
          <>
            <EuiText size="s" style={{ wordBreak: "break-word" }}>
              {component.message}
            </EuiText>
            <EuiSpacer size="m" />
          </>
        )}

        <Card id="summary" title="Process" initialIsOpen>
          <EuiDescriptionList
            compressed
            type="column"
            listItems={[
              { title: "State", description: component.state },
              { title: "Runtime", description: RUNTIME_LABEL[component.runtime] },
              { title: "PID", description: component.pid ? String(component.pid) : component.runtime === "otel" ? "Shares the collector's process" : "—" },
              { title: "Client", description: component.versionInfo?.name ?? "—" },
              ...Object.entries(component.versionInfo?.meta ?? {}).map(([k, v]) => ({ title: k, description: v })),
            ]}
          />
        </Card>

        <Card id="units" title={`Units (${component.units.length})`} extra={unhealthyUnits.length ? <EuiBadge color="warning">{unhealthyUnits.length} not healthy</EuiBadge> : null} initialIsOpen={unhealthyUnits.length > 0}>
          {component.units.map((u) => (
            <UnitRow key={`${u.type}:${u.id}`} unit={u} />
          ))}
        </Card>

        <Card id="transitions" title={`State changes (${own.length})`} initialIsOpen={own.length > 0}>
          <EuiBasicTable<Transition>
            compressed
            items={own.slice(0, 50)}
            noItemsMessage="No state changes since the UI started."
            columns={[
              { field: "at", name: "Time", width: "90px", render: (at: string) => formatTime(at) },
              { field: "target", name: "What", render: (t: string) => (t === component.id ? "component" : `unit ${t.slice(component.id.length + 1)}`) },
              { name: "Change", width: "220px", render: (t: Transition) => <TransitionState t={t} /> },
            ]}
          />
        </Card>

        <Card
          id="logs"
          title="Recent logs"
          extra={
            <>
              {errors > 0 && <EuiBadge color="danger">{errors} errors</EuiBadge>}
              {warnings > 0 && <EuiBadge color="warning">{warnings} warnings</EuiBadge>}
            </>
          }
          initialIsOpen={errors + warnings > 0}
        >
          <LogList entries={logs.entries.slice(-30)} showComponent={false} />
          <EuiSpacer size="s" />
          <EuiButtonEmpty size="xs" iconType="external" onClick={() => navigate(`/logs?component=${encodeURIComponent(component.id)}`)}>
            Open in Logs
          </EuiButtonEmpty>
        </Card>
      </EuiFlyoutBody>
    </EuiFlyout>
  );
}

/**
 * A collapsible card. Until the user toggles it, it follows `initialIsOpen`, because the data that
 * decides it (logs, transitions) arrives after the flyout opens.
 */
function Card({ id, title, extra, initialIsOpen, children }: { id: string; title: string; extra?: React.ReactNode; initialIsOpen: boolean; children: React.ReactNode }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? initialIsOpen;
  return (
    <>
      <EuiPanel hasBorder paddingSize="s">
        <EuiAccordion
          id={`card-${id}`}
          forceState={isOpen ? "open" : "closed"}
          onToggle={setUserOpen}
          buttonContent={
            <EuiTitle size="xxs">
              <h3>{title}</h3>
            </EuiTitle>
          }
          extraAction={extra}
          paddingSize="s"
        >
          {children}
        </EuiAccordion>
      </EuiPanel>
      <EuiSpacer size="s" />
    </>
  );
}

function UnitRow({ unit }: { unit: Unit }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiBadge color="hollow">{unit.type}</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <HealthDot health={unit.health} />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiText size="xs" style={{ wordBreak: "break-all" }}>
        <code>{unit.id}</code>
      </EuiText>
      {unit.message && unit.message !== "Healthy" && (
        <EuiText size="xs" color={unit.health === "healthy" ? "subdued" : "warning"} style={{ wordBreak: "break-word" }}>
          {unit.message}
        </EuiText>
      )}
      {unit.payload != null && (
        <EuiAccordion id={`payload-${unit.type}-${unit.id}`} buttonContent={<EuiText size="xs">Payload</EuiText>} paddingSize="xs">
          <EuiCodeBlock language="json" fontSize="s" paddingSize="s" overflowHeight={240} isCopyable>
            {JSON.stringify(unit.payload, null, 2)}
          </EuiCodeBlock>
        </EuiAccordion>
      )}
    </div>
  );
}

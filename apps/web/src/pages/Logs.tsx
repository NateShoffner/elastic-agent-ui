import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EuiFieldSearch, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSelect, EuiSpacer, EuiSwitch, EuiText } from "@elastic/eui";
import { useSearchParams } from "react-router";
import type { LogLevel, Snapshot } from "@eaui/shared";
import { useLiveLogs } from "../api";
import { LogList } from "../components/LogList";

const LEVEL_OPTIONS = [
  { value: "", text: "All levels" },
  { value: "info", text: "Info and above" },
  { value: "warn", text: "Warnings and errors" },
  { value: "error", text: "Errors only" },
];

export function Logs({ snapshot }: { snapshot: Snapshot }) {
  const [params, setParams] = useSearchParams();
  const component = params.get("component") ?? "";
  const minLevel = (params.get("level") ?? "") as LogLevel | "";
  const telemetry = params.get("telemetry") === "1";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(search);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const logs = useLiveLogs({ component: component || undefined, minLevel: minLevel || undefined, q: q || undefined, telemetry }, { paused: !follow });

  const bottomRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [logs.entries, follow]);

  const componentOptions = [
    { value: "", text: "All components" },
    { value: "agent", text: "Agent itself" },
    ...snapshot.components.map((c) => ({ value: c.id, text: c.id })),
  ];

  return (
    <>
      <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
        <EuiFlexItem grow={3}>
          <EuiFieldSearch placeholder="Filter messages" value={search} onChange={(e) => setSearch(e.target.value)} isClearable fullWidth compressed />
        </EuiFlexItem>
        <EuiFlexItem grow={2}>
          <EuiSelect options={componentOptions} value={component} onChange={(e) => setParam("component", e.target.value)} compressed aria-label="Component" />
        </EuiFlexItem>
        <EuiFlexItem grow={1}>
          <EuiSelect options={LEVEL_OPTIONS} value={minLevel} onChange={(e) => setParam("level", e.target.value)} compressed aria-label="Level" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiSwitch label="Telemetry" checked={telemetry} onChange={(e) => setParam("telemetry", e.target.checked ? "1" : "")} compressed />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiSwitch label="Follow" checked={follow} onChange={(e) => setFollow(e.target.checked)} compressed />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="xs" />
      <EuiText size="xs" color="subdued">
        {logs.error
          ? `Error: ${logs.error}`
          : logs.source
            ? `${logs.entries.length} entries from ${logs.source}${logs.truncated ? " (older entries aren't kept in memory)" : ""}. Collector telemetry dumps are hidden unless "Telemetry" is on.`
            : logs.loading
              ? "Loading…"
              : "No agent log directory found."}
      </EuiText>
      <EuiSpacer size="s" />
      <EuiPanel hasBorder paddingSize="none" style={{ maxHeight: "calc(100vh - 290px)", overflow: "auto" }}>
        <LogList entries={logs.entries} />
        <div ref={bottomRef} />
      </EuiPanel>
    </>
  );
}

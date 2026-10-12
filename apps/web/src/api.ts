import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { matchesLog, type BridgeEvent, type LogEntry, type LogFilter, type LogsResponse, type Snapshot, type TransitionsResponse } from "@eaui/shared";

export class UnauthorizedError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`);
  if (res.status === 401) throw new UnauthorizedError("Not signed in");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function post(path: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export function useSnapshot() {
  return useQuery({ queryKey: ["snapshot"], queryFn: () => get<Snapshot>("/snapshot"), staleTime: Infinity });
}

export function useTransitions() {
  return useQuery({ queryKey: ["transitions"], queryFn: () => get<TransitionsResponse>("/transitions?limit=500"), staleTime: Infinity });
}

/** Log batches from the event stream, for live views that apply their own filters. */
const logBus = new EventTarget();

/**
 * Opens the single SSE connection and feeds it into the query cache. Mount once, near the root.
 * Returns whether the stream is currently open.
 */
export function useBridgeEvents(): boolean {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const es = new EventSource("/api/v1/events");
    es.onopen = () => setOpen(true);
    es.onerror = () => {
      setOpen(false);
      // EventSource hides the HTTP status. Refetching the snapshot surfaces a 401 (e.g. the bridge restarted
      // with a new token) as an UnauthorizedError, which the app turns into the "Not signed in" screen.
      void qc.invalidateQueries({ queryKey: ["snapshot"] });
    };
    const handle = (msg: MessageEvent<string>) => applyEvent(qc, JSON.parse(msg.data) as BridgeEvent);
    for (const type of ["snapshot", "transitions", "logs"]) es.addEventListener(type, handle);
    return () => es.close();
  }, [qc]);
  return open;
}

function applyEvent(qc: QueryClient, event: BridgeEvent) {
  switch (event.type) {
    case "snapshot":
      qc.setQueryData(["snapshot"], event.snapshot);
      break;
    case "transitions":
      qc.setQueryData<TransitionsResponse>(["transitions"], (prev) =>
        prev ? { ...prev, transitions: [...prev.transitions, ...event.transitions].slice(-2_000) } : prev,
      );
      break;
    case "logs":
      logBus.dispatchEvent(new CustomEvent<LogEntry[]>("logs", { detail: event.entries }));
      break;
  }
}

/**
 * Recent log entries matching `filter`: an initial page from the bridge, then live entries from the event
 * stream. `paused` stops appending (the view stays put while you read).
 */
export function useLiveLogs(filter: LogFilter, opts: { limit?: number; paused?: boolean } = {}) {
  const limit = opts.limit ?? 1_000;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [meta, setMeta] = useState<{ source: string | null; truncated: boolean; loading: boolean; error: string | null }>({
    source: null,
    truncated: false,
    loading: true,
    error: null,
  });
  const pausedRef = useRef(opts.paused ?? false);
  pausedRef.current = opts.paused ?? false;
  const key = JSON.stringify(filter);

  useEffect(() => {
    let cancelled = false;
    setMeta((m) => ({ ...m, loading: true, error: null }));
    const params = new URLSearchParams({ limit: String(limit) });
    if (filter.minLevel) params.set("minLevel", filter.minLevel);
    if (filter.component) params.set("component", filter.component);
    if (filter.q) params.set("q", filter.q);
    if (filter.telemetry) params.set("telemetry", "1");
    get<LogsResponse>(`/logs?${params}`)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setMeta({ source: res.source, truncated: res.truncated, loading: false, error: null });
      })
      .catch((err: Error) => !cancelled && setMeta((m) => ({ ...m, loading: false, error: err.message })));

    const onLogs = (e: Event) => {
      if (pausedRef.current) return;
      const fresh = (e as CustomEvent<LogEntry[]>).detail.filter((x) => matchesLog(x, filter));
      if (fresh.length) {
        setEntries((prev) => {
          const lastSeq = prev.at(-1)?.seq ?? 0;
          return [...prev, ...fresh.filter((x) => x.seq > lastSeq)].slice(-limit);
        });
      }
    };
    logBus.addEventListener("logs", onLogs);
    return () => {
      cancelled = true;
      logBus.removeEventListener("logs", onLogs);
    };
    // Re-run only when the filter changes by value (`key`), not on every new filter object.
  }, [key, limit]);

  return { entries, ...meta };
}

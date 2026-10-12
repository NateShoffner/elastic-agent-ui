import { EventEmitter } from "node:events";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { LOG_LEVELS, matchesLog, type LogEntry, type LogFilter, type LogLevel } from "@eaui/shared";
import { sleep } from "../util.ts";

const POLL_MS = 500;
const RESCAN_MS = 2_000;
const BACKFILL_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 4 * 1024 * 1024;
/** Lines bigger than this keep their message but drop the other fields (the collector telemetry dumps are ~70 KB). */
const MAX_FIELD_LINE_BYTES = 16 * 1024;

export interface LogQuery extends LogFilter {
  /** Only entries with seq below this (for paging back). */
  before?: number;
  limit?: number;
}

/** Where we are in the file being tailed. `partial` is a trailing line that hasn't been terminated yet. */
interface Cursor {
  file: string;
  offset: number;
  partial: string;
}

/**
 * Tails the newest `*.ndjson` file in one directory, following rotation (the agent starts a new file
 * rather than truncating), and keeps the most recent entries in memory.
 */
export class LogTailer extends EventEmitter<{ entries: [LogEntry[]] }> {
  readonly dir: string;
  private readonly capacity: number;
  private buffer: LogEntry[] = [];
  private seq = 0;
  /** True once entries have been dropped from the front of the buffer. */
  truncated = false;

  constructor(dir: string, capacity = 10_000) {
    super();
    this.dir = dir;
    this.capacity = capacity;
  }

  query(q: LogQuery): LogEntry[] {
    const limit = Math.min(q.limit ?? 500, 5_000);
    const out: LogEntry[] = [];
    for (let i = this.buffer.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.buffer[i]!;
      if ((q.before === undefined || e.seq < q.before) && matchesLog(e, q)) out.push(e);
    }
    return out.reverse();
  }

  async run(signal: AbortSignal): Promise<void> {
    let cursor: Cursor | null = null;
    const first = await this.newestFile();
    if (first) {
      // Start with the tail of the newest file; its first (probably partial) line is dropped.
      const { size } = await stat(first);
      const start = Math.max(0, size - BACKFILL_BYTES);
      cursor = { file: first, offset: start, partial: "" };
      if (start > 0) {
        this.truncated = true;
        await this.readNew(cursor, { skipFirstLine: true, emit: false });
      } else {
        await this.readNew(cursor, { emit: false });
      }
    }

    let lastScan = Date.now();
    while (!signal.aborted) {
      await sleep(POLL_MS, signal);
      if (signal.aborted) break;
      try {
        if (!cursor || Date.now() - lastScan > RESCAN_MS) {
          lastScan = Date.now();
          const newest = await this.newestFile();
          if (newest && newest !== cursor?.file) {
            // Rotated: finish the old file, including a final line without a newline.
            if (cursor) await this.readNew(cursor, { final: true }).catch(() => {});
            cursor = { file: newest, offset: 0, partial: "" };
          }
        }
        if (cursor) await this.readNew(cursor, {});
      } catch {
        cursor = null; // file vanished or became unreadable; rescan next tick
      }
    }
  }

  /** Reads from `cursor` to the end of its file (in chunks of at most MAX_READ_BYTES), parsing complete lines. */
  private async readNew(cursor: Cursor, opts: { final?: boolean; skipFirstLine?: boolean; emit?: boolean }) {
    const { size } = await stat(cursor.file);
    if (size < cursor.offset) Object.assign(cursor, { offset: 0, partial: "" }); // truncated in place
    if (size === cursor.offset && !(opts.final && cursor.partial)) return;

    const end = opts.final ? size : Math.min(size, cursor.offset + MAX_READ_BYTES);
    const lines = (cursor.partial + (await readRange(cursor.file, cursor.offset, end))).split("\n");
    cursor.partial = opts.final ? "" : (lines.pop() ?? "");
    cursor.offset = end;
    if (opts.skipFirstLine) lines.shift();

    const entries = lines.map((l) => this.parse(l)).filter((e): e is LogEntry => e !== null);
    if (entries.length) {
      this.append(entries);
      if (opts.emit !== false) this.emit("entries", entries);
    }
  }

  private append(entries: LogEntry[]) {
    this.buffer.push(...entries);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
      this.truncated = true;
    }
  }

  private async newestFile(): Promise<string | null> {
    let best: { file: string; mtime: number } | null = null;
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!name.endsWith(".ndjson")) continue;
      const file = path.join(this.dir, name);
      const s = await stat(file).catch(() => null);
      if (s && (!best || s.mtimeMs > best.mtime)) best = { file, mtime: s.mtimeMs };
    }
    return best?.file ?? null;
  }

  private parse(line: string): LogEntry | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let e: Record<string, any>;
    try {
      e = JSON.parse(trimmed);
    } catch {
      return { seq: ++this.seq, ts: new Date().toISOString(), level: "unknown", component: null, logger: null, message: trimmed, telemetry: false, fields: null, bytes: line.length };
    }
    const { message, "@timestamp": ts, "log.level": level, ...rest } = e;
    const msg = String(message ?? "");
    const parsedTs = typeof ts === "string" ? Date.parse(ts) : NaN;
    return {
      seq: ++this.seq,
      ts: Number.isNaN(parsedTs) ? String(ts ?? "") : new Date(parsedTs).toISOString(),
      level: normalizeLevel(level ?? e.log?.level),
      component: rest["component.id"] ?? rest.component?.id ?? null,
      logger: rest["log.logger"] ?? null,
      message: msg,
      telemetry: msg.startsWith("Collector internal telemetry metrics"),
      fields: line.length <= MAX_FIELD_LINE_BYTES ? rest : null,
      bytes: line.length,
    };
  }
}

function normalizeLevel(level: unknown): LogLevel {
  const l = String(level ?? "").toLowerCase();
  if (l === "warning") return "warn";
  if (l === "critical" || l === "panic" || l === "dpanic") return "fatal";
  return (LOG_LEVELS as readonly string[]).includes(l) ? (l as LogLevel) : "unknown";
}

async function readRange(file: string, start: number, end: number): Promise<string> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

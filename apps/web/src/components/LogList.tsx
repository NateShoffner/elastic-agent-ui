import { useState } from "react";
import { EuiBadge, EuiCodeBlock, EuiText } from "@elastic/eui";
import type { LogEntry } from "@eaui/shared";
import { LEVEL_COLOR, formatTime } from "../health";

/** Compact log rows; click a row to see its other fields. Newest last. */
export function LogList({ entries, showComponent = true }: { entries: LogEntry[]; showComponent?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (entries.length === 0) {
    return (
      <EuiText size="s" color="subdued">
        No matching log entries.
      </EuiText>
    );
  }
  return (
    <div style={{ fontFamily: "var(--euiCodeFontFamily, monospace)", fontSize: 12 }}>
      {entries.map((e) => (
        <div key={e.seq} style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOpen(open === e.seq ? null : e.seq)}
            onKeyDown={(ev) => ev.key === "Enter" && setOpen(open === e.seq ? null : e.seq)}
            style={{ display: "flex", gap: 8, padding: "3px 4px", cursor: "pointer", alignItems: "baseline" }}
          >
            <span style={{ whiteSpace: "nowrap", opacity: 0.7 }} title={e.ts}>
              {formatTime(e.ts)}
            </span>
            {/* Fixed min-width keeps messages aligned; the badge itself must never shrink, or EUI ellipsizes it. */}
            <span style={{ minWidth: 64, flexShrink: 0 }}>
              <EuiBadge color={LEVEL_COLOR[e.level]} style={{ maxWidth: "none" }}>
                {e.level}
              </EuiBadge>
            </span>
            {showComponent && (
              <span style={{ width: 200, flexShrink: 0, wordBreak: "break-all", opacity: 0.8 }}>
                {e.component ?? "agent"}
              </span>
            )}
            <span style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
              {e.message}
            </span>
          </div>
          {open === e.seq && (
            <div style={{ padding: "0 4px 8px 4px" }}>
              {e.fields ? (
                <EuiCodeBlock language="json" fontSize="s" paddingSize="s" overflowHeight={300} isCopyable>
                  {JSON.stringify(e.fields, null, 2)}
                </EuiCodeBlock>
              ) : (
                <EuiText size="xs" color="subdued">
                  This line is {Math.round(e.bytes / 1024)} KB; its fields aren't kept in memory.
                </EuiText>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

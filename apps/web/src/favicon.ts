import type { Health } from "@eaui/shared";

// Fixed hex colors rather than EUI theme tokens: the favicon has to work on any tab-strip background.
const DOT: Record<Health, string> = {
  healthy: "#24C292",
  starting: "#1BA9F5",
  degraded: "#FCD883",
  failed: "#E7664C",
  unreachable: "#E7664C",
  stopped: "#98A2B3",
  updating: "#B07CDB",
};

/** A small "agent" mark: a sensor ring on Elastic blue, with an optional health dot in the corner. */
function svg(health: Health | null): string {
  const dot = health
    ? `<circle cx="25" cy="25" r="7" fill="${DOT[health]}" stroke="#ffffff" stroke-width="2"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="7" fill="#0B64DD"/>
  <circle cx="16" cy="16" r="8.5" fill="none" stroke="#ffffff" stroke-width="2.5"/>
  <circle cx="16" cy="16" r="3.5" fill="#ffffff"/>
  ${dot}
</svg>`;
}

let link: HTMLLinkElement | null = null;
let current: Health | null | undefined;

/** Points the tab icon at the mark for `health` (null for no dot). No-op if unchanged. */
export function setFaviconHealth(health: Health | null) {
  if (health === current) return;
  current = health;
  link ??= document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg(health))}`;
}


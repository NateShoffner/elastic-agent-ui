import { EuiBadge, EuiHealth } from "@elastic/eui";
import type { Health } from "@eaui/shared";
import { HEALTH_COLOR, HEALTH_LABEL } from "../health";

export function HealthBadge({ health, label }: { health: Health; label?: string }) {
  const color = HEALTH_COLOR[health];
  return <EuiBadge color={color === "subdued" ? "default" : color}>{label ?? HEALTH_LABEL[health]}</EuiBadge>;
}

export function HealthDot({ health, children }: { health: Health; children?: React.ReactNode }) {
  return <EuiHealth color={HEALTH_COLOR[health]}>{children ?? HEALTH_LABEL[health]}</EuiHealth>;
}

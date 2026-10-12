import { EuiFlexGroup, EuiFlexItem, EuiIcon, EuiText } from "@elastic/eui";
import { stateHealth, type AgentState, type Transition } from "@eaui/shared";
import { HealthDot } from "./HealthBadge";

function StateLabel({ state }: { state: AgentState | null }) {
  if (!state) {
    return (
      <EuiText size="xs" color="subdued">
        <em>none</em>
      </EuiText>
    );
  }
  return <HealthDot health={stateHealth(state)}>{state.toLowerCase()}</HealthDot>;
}

export function TransitionState({ t }: { t: Transition }) {
  return (
    <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>
        <StateLabel state={t.from} />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiIcon type="sortRight" size="s" />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <StateLabel state={t.to} />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}

import type { PolicyInfo } from "@eaui/shared";
import { parse as parseYaml } from "yaml";
import { errorMessage, run, truncate } from "../util.ts";
import { agentCommand } from "../platform/paths.ts";

type Doc = Record<string, any>;

/**
 * Reads the effective policy summary via `elastic-agent inspect`. For Fleet-managed agents the policy
 * is encrypted on disk, so this is the practical way to get it. It takes several seconds, so callers cache it.
 */
export async function readPolicy(binary: string): Promise<PolicyInfo> {
  const fetchedAt = new Date().toISOString();
  const empty: PolicyInfo = {
    policyId: null,
    revision: null,
    agentId: null,
    fleetHosts: [],
    outputs: [],
    inputs: [],
    logLevel: null,
    fetchedAt,
    error: null,
  };
  try {
    const [cmd, args] = agentCommand(binary, ["inspect"]);
    const res = await run(cmd, args, 60_000);
    if (res.code !== 0) return { ...empty, error: truncate(res.stderr || res.stdout, 500) };
    const doc = parseYaml(res.stdout) as Doc;
    const inputs: Doc[] = Array.isArray(doc.inputs) ? doc.inputs : [];
    return {
      policyId: doc.id ?? null,
      revision: typeof doc.revision === "number" ? doc.revision : null,
      agentId: doc.agent?.id ?? doc.fleet?.agent?.id ?? null,
      fleetHosts: Array.isArray(doc.fleet?.hosts) ? doc.fleet.hosts : [],
      outputs: Object.entries((doc.outputs ?? {}) as Doc).map(([name, o]) => ({ name, type: String(o?.type ?? "") })),
      inputs: inputs.map((i) => ({
        id: String(i.id ?? ""),
        type: String(i.type ?? ""),
        name: i.name ?? null,
        package: i.meta?.package?.name ?? null,
        useOutput: i.use_output ?? null,
        streams: Array.isArray(i.streams) ? i.streams.length : 0,
      })),
      logLevel: doc.agent?.logging?.level ?? null,
      fetchedAt,
      error: null,
    };
  } catch (err) {
    return { ...empty, error: errorMessage(err) };
  }
}

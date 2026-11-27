import { ResponseBuilder } from "../../../core/api/response.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { fetchCloudModelGroups } from "../../models/use-cases/get-cloud-models.ts";
import type { CloudModelGroup } from "../../models/use-cases/get-cloud-models.ts";
import {
  defaultDeps,
  type DiscoveryDeps,
  searchModels,
} from "../../model-discovery/use-cases/model-discovery.ts";
import { detectHardware } from "../lib/detect-hardware.ts";
import { getFitContext } from "./get-fit-context.ts";
import type { FitContext, HardwareProfile } from "../types.ts";

export interface CloudSuggestion {
  keyId: string;
  alias: string;
  provider: string;
  model: string;
}

export interface HardwareReport {
  profile: HardwareProfile;
  context: FitContext;
  plugins: { name: string; tokens: number }[];
  /** No curated model with tool support runs well on this machine */
  noToolModelFits: boolean;
  /** Only meaningful when `noToolModelFits`; null when no cloud API key is configured */
  cloudSuggestion: CloudSuggestion | null;
  hasCloudKey: boolean;
}

export function pickCloudSuggestion(
  groups: CloudModelGroup[],
): CloudSuggestion | null {
  for (const group of groups) {
    const model = group.models.find((m) => m.toolSupport.status === "supported");
    if (model) {
      return {
        keyId: group.keyId,
        alias: group.alias,
        provider: group.provider,
        model: model.name,
      };
    }
  }
  return null;
}

export async function buildHardwareReport(
  deps: DiscoveryDeps,
  plugins: HardwareReport["plugins"],
  cloudGroups: () => Promise<CloudModelGroup[]>,
): Promise<HardwareReport> {
  const [profile, context, recommended] = await Promise.all([
    deps.profile(),
    deps.fitContext(),
    searchModels("", deps),
  ]);
  const noToolModelFits = !recommended.items.some((i) =>
    i.card.capabilities.tools && i.fit?.status === "fits"
  );
  const groups = noToolModelFits ? await cloudGroups().catch(() => []) : [];
  return {
    profile,
    context,
    plugins,
    noToolModelFits,
    cloudSuggestion: noToolModelFits ? pickCloudSuggestion(groups) : null,
    hasCloudKey: groups.length > 0,
  };
}

export async function handleGetHardware(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Promise<Response> {
  const { context, plugins } = await getFitContext(hive);
  const deps: DiscoveryDeps = {
    ...defaultDeps(hive),
    profile: () => detectHardware(),
    fitContext: () => Promise.resolve(context),
  };
  return ResponseBuilder.success(
    await buildHardwareReport(deps, plugins, fetchCloudModelGroups),
    { headers },
  );
}

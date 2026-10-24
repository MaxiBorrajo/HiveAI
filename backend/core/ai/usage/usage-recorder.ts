import type { NewModelUsage } from "../../../infrastructure/db/schema/model_usage.ts";

export type UsageLink =
  | { kind: "chat"; chatId: number }
  | { kind: "execution"; executionId: number; nodeId: string | null }
  | { kind: "graph_generation"; executionId: number | null }
  | { kind: "other" };

export interface UsageEntry {
  usage: NewModelUsage;
  link: UsageLink;
}

export interface UsageRecorder {
  record(entry: UsageEntry): Promise<void>;
}

let recorder: UsageRecorder | undefined;

export function setUsageRecorder(next: UsageRecorder | undefined): void {
  recorder = next;
}

export function getUsageRecorder(): UsageRecorder | undefined {
  return recorder;
}

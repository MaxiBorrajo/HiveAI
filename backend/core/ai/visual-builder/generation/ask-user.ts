import {
  executionContextStorage,
  humanInteractionQueue,
} from "../../../microkernel/human-interaction.ts";
import type { IncrementalEvent } from "../types.ts";

export function canAskUser(): boolean {
  return executionContextStorage.getStore()?.interactive === true;
}

export async function* askUser(
  question: string,
  options: string[] | undefined,
  kind: "clarify" | "plan_review",
): AsyncGenerator<IncrementalEvent, string, unknown> {
  if (!canAskUser()) return "";

  yield { type: "waiting_for_user", kind, question };
  const { wait } = humanInteractionQueue.requestClarification(
    "visual_builder",
    { kind: "clarify", question, options },
  );
  const answer = (await wait).trim();
  if (answer) yield { type: "user_answered", kind, question, answer };
  return answer;
}

import { assertEquals } from "@std/assert";
import {
  executionContextStorage,
  humanInteractionQueue,
} from "../../../../core/microkernel/human-interaction.ts";

Deno.test("unattended runs decline approvals and leave questions unanswered without queueing", async () => {
  await executionContextStorage.run({ autoApprove: false, unattended: true }, async () => {
    const approval = humanInteractionQueue.requestApproval("p", {
      kind: "approval",
      title: "t",
      description: "d",
    });
    const clarify = humanInteractionQueue.requestClarification("p", {
      kind: "clarify",
      question: "q",
    });
    assertEquals(await approval.wait, false);
    assertEquals(await clarify.wait, "");
    assertEquals(humanInteractionQueue.list().length, 0);
  });
});

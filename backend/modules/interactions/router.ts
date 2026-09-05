import { Hono } from "hono";
import { handleListInteractions } from "./useCases/listInteractions/index.ts";
import { handleResolveInteraction } from "./useCases/resolveInteraction/index.ts";

// Generic human-interaction flow: any plugin can block waiting for one of
// these to resolve its pending entry before it proceeds (see
// core/microkernel/human-interaction.ts and BeeContext.requestApproval). The
// frontend polls GET / and renders UI based on each entry's payload.kind.
export const interactionsRouter = new Hono();

interactionsRouter.get("/", (c) => {
  return handleListInteractions({ "content-type": "application/json" });
});

interactionsRouter.post("/:id/:decision", (c) => {
  const id = c.req.param("id");
  const decision = c.req.param("decision");

  if (decision !== "approve" && decision !== "reject") {
    return Response.json(
      { error: "decision must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  return handleResolveInteraction(id, decision, {
    "content-type": "application/json",
  });
});

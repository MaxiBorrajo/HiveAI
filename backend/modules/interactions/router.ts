import { Hono } from "hono";
import { handleListInteractions } from "./useCases/listInteractions/index.ts";
import { handleResolveInteraction } from "./useCases/resolveInteraction/index.ts";
import { ResponseBuilder } from "../../core/api/response.ts";

export const interactionsRouter = new Hono();

interactionsRouter.get("/", (c) => {
  return handleListInteractions({ "content-type": "application/json" });
});

interactionsRouter.post("/:id/:decision", (c) => {
  const id = c.req.param("id");
  const decision = c.req.param("decision");

  if (decision !== "approve" && decision !== "reject") {
    return ResponseBuilder.error(
      ["decision must be 'approve' or 'reject'"],
      undefined,
      { status: 400 },
    );
  }

  return handleResolveInteraction(id, decision, {
    "content-type": "application/json",
  });
});

import { Hono } from "hono";
import { handleExternalPluginRequestApproval } from "./useCases/requestApproval/index.ts";
import { handleExternalPluginReportStep } from "./useCases/reportStep/index.ts";

export const externalPluginCallbacksRouter = new Hono();

externalPluginCallbacksRouter.post("/request-approval", (c) => {
  return handleExternalPluginRequestApproval(c.req.raw, {
    "content-type": "application/json",
  });
});

externalPluginCallbacksRouter.post("/report-step", (c) => {
  return handleExternalPluginReportStep(c.req.raw, {
    "content-type": "application/json",
  });
});

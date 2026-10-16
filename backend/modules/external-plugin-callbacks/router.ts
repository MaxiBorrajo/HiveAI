import { Hono } from "hono";
import { handleExternalPluginRequestApproval } from "./use-cases/request-approval.ts";
import { handleExternalPluginReportStep } from "./use-cases/report-step.ts";
import { handleExternalPluginGetConfig } from "./use-cases/get-config.ts";

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

externalPluginCallbacksRouter.post("/get-config", (c) => {
  return handleExternalPluginGetConfig(c.req.raw, {
    "content-type": "application/json",
  });
});

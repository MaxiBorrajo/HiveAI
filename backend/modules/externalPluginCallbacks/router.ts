import { Hono } from "hono";
import { handleExternalPluginRequestApproval } from "./useCases/requestApproval/index.ts";
import { handleExternalPluginReportStep } from "./useCases/reportStep/index.ts";

// Called by plugin-runner.ts subprocesses (never by the frontend). An
// external plugin can't talk to humanInteractionQueue/step-capture directly
// — those live only in this main process — so BeeContext.requestApproval /
// reportStep inside the subprocess proxy back here over HTTP instead.
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

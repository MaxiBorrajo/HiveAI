import { reportPluginStepForCall } from "../../../../core/microkernel/step-capture.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { parseJsonBody } from "../../../../core/api/request.ts";

export async function handleExternalPluginReportStep(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<{ callId?: unknown; label?: unknown }>(
    req,
    headers,
  );
  if ("errorResponse" in parsed) return parsed.errorResponse;
  const { callId, label } = parsed.body;

  if (typeof label !== "string") {
    return ResponseBuilder.error(
      ["'label' is required and must be a string."],
      undefined,
      { status: 400, headers },
    );
  }

  if (typeof callId !== "string") {
    return ResponseBuilder.success({ recorded: false }, { headers });
  }

  const recorded = reportPluginStepForCall(callId, label);
  return ResponseBuilder.success({ recorded }, { headers });
}

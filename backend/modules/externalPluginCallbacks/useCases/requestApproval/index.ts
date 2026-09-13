import { humanInteractionQueue } from "../../../../core/microkernel/human-interaction.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { parseJsonBody } from "../../../../core/api/request.ts";

interface RequestApprovalBody {
  pluginName?: string;
  title?: string;
  description?: string;
  details?: Record<string, string>;
}

export async function handleExternalPluginRequestApproval(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<RequestApprovalBody>(req, headers);
  if ("errorResponse" in parsed) return parsed.errorResponse;
  const { pluginName, title, description, details } = parsed.body;

  if (!pluginName || !title || !description) {
    return ResponseBuilder.error(
      ["'pluginName', 'title', and 'description' are required."],
      undefined,
      { status: 400, headers },
    );
  }

  const { wait } = humanInteractionQueue.requestApproval(pluginName, {
    kind: "approval",
    title,
    description,
    details,
  });
  const approved = await wait;

  return ResponseBuilder.success({ approved }, { headers });
}

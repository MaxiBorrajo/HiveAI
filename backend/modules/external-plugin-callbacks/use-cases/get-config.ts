import { getSecretStore } from "../../../core/secrets/index.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { parseJsonBody } from "../../../core/api/request.ts";

interface GetConfigBody {
  pluginName?: string;
  key?: string;
}

export async function handleExternalPluginGetConfig(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const parsed = await parseJsonBody<GetConfigBody>(req, headers);
  if ("errorResponse" in parsed) return parsed.errorResponse;
  const { pluginName, key } = parsed.body;

  if (!pluginName || !key) {
    return ResponseBuilder.error(
      ["'pluginName' and 'key' are required."],
      undefined,
      { status: 400, headers },
    );
  }

  const value = await getSecretStore().get(`${pluginName}:${key}`);
  return ResponseBuilder.success({ value: value ?? null }, { headers });
}

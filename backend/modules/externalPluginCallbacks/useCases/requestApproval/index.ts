import { humanInteractionQueue } from "../../../../core/microkernel/human-interaction.ts";

export async function handleExternalPluginRequestApproval(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.json();
  const { pluginName, title, description, details } = body;

  if (!pluginName || !title || !description) {
    return Response.json(
      { error: "'pluginName', 'title', and 'description' are required." },
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

  return Response.json({ approved }, { headers });
}

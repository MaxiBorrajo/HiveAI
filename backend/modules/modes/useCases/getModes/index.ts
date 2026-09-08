import modes from '../../../../config/modes.config.json' with { type: "json" };

export function getModes(
  headers: Record<string, string>,
): Response {
  return Response.json(modes, { headers });
}

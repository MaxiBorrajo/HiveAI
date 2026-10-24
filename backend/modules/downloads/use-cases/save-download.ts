import { ResponseBuilder } from "../../../core/api/response.ts";
import { saveToDownloads } from "../../../core/files/save-to-downloads.ts";

export async function handleSaveDownload(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  let body: { filename?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return ResponseBuilder.error(["Invalid JSON body."], undefined, {
      status: 400,
      headers,
    });
  }

  if (
    typeof body.filename !== "string" || !body.filename.trim() ||
    typeof body.content !== "string"
  ) {
    return ResponseBuilder.error(
      ["'filename' and 'content' must be strings."],
      undefined,
      { status: 400, headers },
    );
  }

  const path = await saveToDownloads(body.filename, body.content);
  return ResponseBuilder.success({ path }, { headers });
}

import { saveToDownloads } from "../../../core/files/save-to-downloads.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";

export async function handleSaveTestResults(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.text();

  const filePath = await saveToDownloads(
    `plugin_test_results_${new Date().toISOString().replace(/:/g, "-")}.json`,
    body,
  );

  return ResponseBuilder.success({ path: filePath }, { headers });
}

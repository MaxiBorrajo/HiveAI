import { join } from "node:path";
import { homeDir } from "hive-ai";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleSaveTestResults(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.text();

  const downloadsDir = join(homeDir!, "Downloads");
  await Deno.mkdir(downloadsDir, { recursive: true });

  const filePath = join(
    downloadsDir,
    `plugin_test_results_${new Date().toISOString().replace(/:/g, "-")}.json`,
  );

  await Deno.writeTextFile(filePath, body);

  return ResponseBuilder.success({ path: filePath }, { headers });
}

import { join } from "node:path";
import { homeDir } from "hive-ai";

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

  return Response.json({ path: filePath }, { headers });
}

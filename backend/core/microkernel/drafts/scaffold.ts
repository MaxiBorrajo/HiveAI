import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const CORE_BEE_PLUGIN_URL = new URL("../bee-plugin.ts", import.meta.url);

function toClassName(pluginName: string): string {
  return pluginName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function buildIndexTs(pluginName: string): string {
  const className = toClassName(pluginName) || "MyPlugin";
  return `import { z } from "zod";
import type { BeeContext, BeePlugin } from "./bee-plugin.ts";

const schema = z.object({
  // Define the parameters your plugin needs here.
  // example: z.string().describe("what this parameter is for"),
});

export default class ${className} implements BeePlugin<typeof schema> {
  name = "${pluginName}";
  description = "TODO: describe what this plugin does and when it should be used.";
  schema = schema;
  // Optional: describe what the returned string looks like/means, so the
  // caller knows how to interpret it.
  // returnDescription = "TODO: describe the shape/meaning of the returned string.";

  // At least 3 "positive", 3 "negative" and 3 "ambiguous" cases are
  // required before this plugin can be registered.
  selectionTests = [
    // { query: "...", kind: "positive", shouldInvoke: true },
    // { query: "...", kind: "negative", shouldInvoke: false },
    // { query: "...", kind: "ambiguous", shouldInvoke: false },
  ];

  // At least 3 "happy", 3 "edge" and 3 "error" cases are required before
  // this plugin can be registered.
  executionTests = [
    // {
    //   description: "...",
    //   kind: "happy",
    //   params: {},
    //   expect: (output: string) => output.includes("..."),
    // },
  ];

  initialize(_context: BeeContext) {
    // Runs once when the plugin is registered. Use it to prepare anything
    // the plugin needs (e.g. reading context.getDataDir()).
  }

  async process(
    input: z.infer<typeof schema>,
    _options?: { signal?: AbortSignal },
  ): Promise<string> {
    // TODO: implement the plugin's actual behavior.
    return "TODO";
  }

  // Optional: runs when the plugin is deactivated/unregistered. Use it to
  // release anything acquired in initialize() (timers, connections, etc.).
  // dispose() {}
}
`;
}

export interface ScaffoldResult {
  dir: string;
}

export async function scaffoldDraftPlugin(
  draftsDir: string,
  pluginName: string,
): Promise<ScaffoldResult> {
  const dir = join(draftsDir, pluginName);
  await mkdir(dir, { recursive: true });

  const coreBeePlugin = await readFile(CORE_BEE_PLUGIN_URL);
  await writeFile(join(dir, "bee-plugin.ts"), coreBeePlugin);
  await writeFile(join(dir, "index.ts"), buildIndexTs(pluginName));

  return { dir };
}

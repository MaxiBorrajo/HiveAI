import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  BeeContext,
  BeePlugin,
  PluginTestCase,
} from "../../microkernel/bee-plugin.ts";

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_RESULTS = 20;
const MAX_CONCURRENCY = 8;

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  ".cache",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "AppData",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

export default class FileSearchPlugin implements BeePlugin {
  name = "file_search";
  description =
    "Searches for a file or folder in the system by its name (or part of it) and returns the full path where it is located, if it exists. By default, it searches in the user's common folders (Desktop, Documents, Downloads, home folder); optionally, a specific folder can be provided to search in.";

  schema = z.object({
    name: z
      .string()
      .describe(
        "Name of the file or folder to search for, for example 'report.pdf' or 'report'. The search is case-insensitive and performs a partial match.",
      ),
    folder: z
      .string()
      .optional()
      .describe(
        "Absolute path of a specific folder to search in. If omitted, it searches in the user's common folders (Desktop, Documents, Downloads, and home).",
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .default(DEFAULT_MAX_RESULTS)
      .describe("Maximum number of matches to return."),
  }) as any;

  testCases: PluginTestCase[] = [
    {
      query: "buscá el archivo informe.pdf en mis documentos",
      shouldInvoke: true,
      expectedParams: { name: "informe.pdf" },
    },
    {
      query: "¿qué hora es?",
      shouldInvoke: false,
    },
  ];

  initialize(_context: BeeContext): void {}

  private getDefaultSearchDirs(): string[] {
    const home = homedir();
    return [
      join(home, "Desktop"),
      join(home, "Documents"),
      join(home, "Downloads"),
      home,
    ];
  }

  // Traverses `dir` in parallel (with bounded concurrency) looking for matches.
  // `matches`/`seen` are shared among all branches to be able to cut off
  // as soon as `maxResults` is reached, without each branch waiting for the others.
  private async searchDir(
    dir: string,
    depth: number,
    searchTerm: string,
    matches: string[],
    seen: Set<string>,
    maxResults: number,
  ): Promise<void> {
    if (depth < 0 || matches.length >= maxResults) return;

    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(dir)) {
        entries.push(entry);
      }
    } catch {
      return;
    }

    const subDirs: string[] = [];

    for (const entry of entries) {
      if (matches.length >= maxResults) return;

      const fullPath = join(dir, entry.name);

      if (
        entry.name.toLowerCase().includes(searchTerm) &&
        !seen.has(fullPath)
      ) {
        seen.add(fullPath);
        matches.push(fullPath);
      }

      if (entry.isDirectory && !EXCLUDED_DIR_NAMES.has(entry.name)) {
        subDirs.push(fullPath);
      }
    }

    await this.runWithConcurrency(subDirs, MAX_CONCURRENCY, (subDir) =>
      this.searchDir(subDir, depth - 1, searchTerm, matches, seen, maxResults),
    );
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;

    async function worker() {
      while (index < items.length) {
        const current = items[index++];
        await task(current);
      }
    }

    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      worker,
    );
    await Promise.all(workers);
  }

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { name, folder, maxResults } = parsed.data;
    const searchTerm = name.toLowerCase();

    const searchDirs = folder ? [folder] : this.getDefaultSearchDirs();

    if (folder) {
      try {
        await Deno.stat(folder);
      } catch {
        return `The specified folder does not exist or is not accessible: ${folder}`;
      }
    }

    const matches: string[] = [];
    const seen = new Set<string>();

    await Promise.all(
      searchDirs.map((dir) =>
        this.searchDir(
          dir,
          DEFAULT_MAX_DEPTH,
          searchTerm,
          matches,
          seen,
          maxResults,
        ),
      ),
    );

    if (matches.length === 0) {
      const where = folder
        ? `in the folder '${folder}'`
        : "in the user's common folders (Desktop, Documents, Downloads, home)";
      return `No file or folder matching '${name}' was found ${where}.`;
    }

    const limited = matches.slice(0, maxResults);
    const list = limited.map((p) => `- ${p}`).join("\n");
    return `Found ${limited.length} match(es) for '${name}':\n${list}`;
  }
}

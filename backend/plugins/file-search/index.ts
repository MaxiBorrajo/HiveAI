import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  BeePlugin,
  BeeContext,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_RESULTS = 20;
const MAX_CONCURRENCY = 32;

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

const schema = z.object({
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
});

type FileSearchSchema = typeof schema;

export default class FileSearchPlugin implements BeePlugin<FileSearchSchema> {
  name = "file_search";
  description =
    "Searches for a file or folder in the system by its name (or part of it) and returns the full path where it is located, if it exists. By default, it searches in the user's common folders (Desktop, Documents, Downloads, home folder); optionally, a specific folder can be provided to search in. Substring to search for in file or folder names, for example 'report' or '.ts'. The search is case-insensitive and performs a partial match. Do NOT use glob patterns like '*.ts' — pass just 'ts' instead.";

  schema = schema;

  selectionTests: SelectionTestCase<FileSearchSchema>[] = [
    // 3 Positive
    {
      query: "search for the file report.pdf in my documents",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "where did I save index.ts?",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "find the backend folder on my machine",
      kind: "positive",
      shouldInvoke: true,
    },
    // 3 Negative
    {
      query: "what time is it?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "reset the counter",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "explain how quicksort works in Python",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "read what is inside README.md",
      kind: "ambiguous",
    },
    {
      query: "search the web for TypeScript tutorials",
      kind: "ambiguous",
    },
    {
      query: "check if port 8000 is open",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<FileSearchSchema>[] = [
    // 3 Happy
    {
      description: "Search for a known existing file in current directory",
      kind: "happy",
      params: { name: "deno.json", folder: Deno.cwd(), maxResults: 5 },
      expect: (output: string) =>
        output.includes("Found") && output.includes("deno.json"),
    },
    {
      description: "Search for a partial name match in current directory",
      kind: "happy",
      params: { name: "bee-plugin", folder: Deno.cwd(), maxResults: 5 },
      expect: (output: string) =>
        output.includes("Found") && output.includes("bee-plugin"),
    },
    {
      description: "Search for a folder by name in current directory",
      kind: "happy",
      params: { name: "plugins", folder: Deno.cwd(), maxResults: 5 },
      expect: (output: string) =>
        output.includes("Found") && output.includes("plugins"),
    },
    // 3 Edge
    {
      description: "Search with maxResults capped to 1",
      kind: "edge",
      params: { name: "ts", folder: Deno.cwd(), maxResults: 1 },
      expect: (output: string) => output.includes("Found 1 match(es)"),
    },
    {
      description: "Search for a non-existent file name in valid folder",
      kind: "edge",
      params: {
        name: "non_existent_file_xyz_123456789.none",
        folder: Deno.cwd(),
        maxResults: 5,
      },
      expect: (output: string) => output.includes("No file or folder matching"),
    },
    {
      description: "Search with uppercase name (case-insensitive test)",
      kind: "edge",
      params: { name: "DENO.JSON", folder: Deno.cwd(), maxResults: 5 },
      expect: (output: string) =>
        output.includes("Found") && output.toLowerCase().includes("deno.json"),
    },
    // 3 Error
    {
      description: "Search in a non-existent folder",
      kind: "error",
      params: {
        name: "test",
        folder: "/non/existent/directory/path/12345",
        maxResults: 5,
      },
      expect: (output: string) =>
        output.includes("does not exist or is not accessible"),
    },
    {
      description: "Invalid maxResults below minimum (< 1)",
      kind: "error",
      params: { name: "test", folder: Deno.cwd(), maxResults: 0 as any },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
    {
      description: "Missing required name property",
      kind: "error",
      params: { name: undefined as any, folder: Deno.cwd(), maxResults: 5 },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
  ];

  get testCases() {
    return this.selectionTests;
  }

  initialize(_context: BeeContext): void {}

  private getDefaultSearchDirs(): string[] {
    const home = homedir();
    const dirs = [home];

    const oneDrive = Deno.env.get("OneDrive") ?? Deno.env.get("OneDriveConsumer");
    if (oneDrive && oneDrive !== home) {
      dirs.push(oneDrive);
    }

    return dirs;
  }

  // Breadth-first search across all `roots` at once, using a single shared queue
  // and a fixed pool of MAX_CONCURRENCY workers that live for the whole search.
  // Unlike a per-directory recursive fan-out, this caps the number of directories
  // being read at any given moment to a constant, regardless of how wide the tree
  // is at any level — a directory with hundreds of subfolders can't spawn hundreds
  // of concurrent Deno.readDir calls.
  private async searchDirs(
    roots: string[],
    maxDepth: number,
    searchTerm: string,
    maxResults: number,
  ): Promise<string[]> {
    const matches: string[] = [];
    const seen = new Set<string>();

    type QueueItem = { dir: string; depth: number };
    const queue: QueueItem[] = roots.map((dir) => ({ dir, depth: maxDepth }));
    let cursor = 0;
    // Tracks workers currently mid-readDir: if it hits 0 while the queue is
    // drained, the search is genuinely done (nothing left to ever enqueue).
    // Without this, a worker that finds the queue temporarily empty would
    // exit for good even though a sibling worker is about to enqueue more
    // subdirectories for it to pick up.
    let workersInFlight = 0;

    const worker = async () => {
      while (matches.length < maxResults) {
        if (cursor >= queue.length) {
          if (workersInFlight === 0) return;
          await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }

        const { dir, depth } = queue[cursor++];
        if (depth < 0) continue;

        workersInFlight++;
        let entries: Deno.DirEntry[];
        try {
          entries = [];
          for await (const entry of Deno.readDir(dir)) {
            entries.push(entry);
          }
        } catch {
          workersInFlight--;
          continue;
        }
        workersInFlight--;

        for (const entry of entries) {
          if (matches.length >= maxResults) return;

          const fullPath = join(dir, entry.name);

          if (entry.name.toLowerCase().includes(searchTerm) && !seen.has(fullPath)) {
            seen.add(fullPath);
            matches.push(fullPath);
          }

          if (entry.isDirectory && !EXCLUDED_DIR_NAMES.has(entry.name)) {
            queue.push({ dir: fullPath, depth: depth - 1 });
          }
        }
      }
    };

<<<<<<< HEAD
    const workers = Array.from({ length: MAX_CONCURRENCY }, worker);
=======
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
>>>>>>> 8000f851ab2355e3c7187b0787f89964db82db5e
    await Promise.all(workers);

    return matches;
  }

  async process(input: z.infer<FileSearchSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { name, folder, maxResults } = parsed.data;
    const searchTerm = name.toLowerCase();

    const roots = folder ? [folder] : this.getDefaultSearchDirs();

    if (folder) {
      try {
        await Deno.stat(folder);
      } catch {
        return `The specified folder does not exist or is not accessible: ${folder}`;
      }
    }

<<<<<<< HEAD
    const matches = await this.searchDirs(
      roots,
      DEFAULT_MAX_DEPTH,
      searchTerm,
      maxResults,
=======
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
>>>>>>> 8000f851ab2355e3c7187b0787f89964db82db5e
    );

    if (matches.length === 0) {
      const where = folder
        ? `in the folder '${folder}'`
        : "in the user's home folder (including Desktop, Documents, Downloads, etc.)";
      return `No file or folder matching '${name}' was found ${where}.`;
    }

    const limited = matches.slice(0, maxResults);
    const list = limited.map((p) => `- ${p}`).join("\n");
    return `Found ${limited.length} match(es) for '${name}':\n${list}`;
  }
}

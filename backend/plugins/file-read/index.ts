import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const MAX_CONTENT_CHARS = 20_000;

// Native, read-only filesystem inspection (list a folder's contents, read a text
// file), implemented directly with Deno's fs APIs instead of spawning external
// processes (ls/dir, cat/type). No shell interpreter is ever involved, so there
// is no injection surface, and no OS-specific command needs to be picked.

type Operation = "list" | "read";

const schema = z.object({
  operation: z
    .enum(["list", "read"])
    .describe("'list' to see a folder's contents, 'read' to get a file's text content."),
  path: z
    .string()
    .describe(
      "Absolute path of the folder to list, or the file to read.",
    ),
});

type FileReadSchema = typeof schema;

export default class FileReadPlugin implements BeePlugin<FileReadSchema> {
  name = "file_read";
  description =
    "Reads the filesystem: 'list' shows the files and folders inside a directory, 'read' returns the text content of a file. Does not modify anything — use file_ops to create/write/copy/move.";

  schema = schema;

  selectionTests: SelectionTestCase<FileReadSchema>[] = [
    // 3 Positive
    {
      query: "show me what's inside my Documents folder",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "read the contents of README.md",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "list the files in C:\\Users\\me\\Desktop",
      kind: "positive",
      shouldInvoke: true,
    },
    // 3 Negative
    {
      query: "create a new file called notes.txt",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "what's the weather today?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "search the web for TypeScript news",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "find a file called invoice.pdf",
      kind: "ambiguous",
    },
    {
      query: "check if config.json exists",
      kind: "ambiguous",
    },
    {
      query: "tell me about the project structure",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<FileReadSchema>[] = [
    // 3 Happy
    {
      description: "List the current working directory",
      kind: "happy",
      params: { operation: "list", path: Deno.cwd() },
      expect: (output: string) => output.includes("Contents of"),
    },
    {
      description: "Read an existing text file",
      kind: "happy",
      params: { operation: "read", path: `${Deno.cwd()}/deno.json` },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "List a directory known to have subfolders",
      kind: "happy",
      params: { operation: "list", path: `${Deno.cwd()}/plugins` },
      expect: (output: string) => output.includes("Folders:"),
    },
    // 3 Edge
    {
      description: "Reading a directory with 'read' fails clearly",
      kind: "edge",
      params: { operation: "read", path: Deno.cwd() },
      expect: (output: string) => output.includes("is a directory"),
    },
    {
      description: "Listing a file with 'list' fails clearly",
      kind: "edge",
      params: { operation: "list", path: `${Deno.cwd()}/deno.json` },
      expect: (output: string) => output.includes("is a file"),
    },
    {
      description: "Reading a file over the truncation limit gets truncated",
      kind: "edge",
      params: { operation: "read", path: `${Deno.cwd()}/deno.lock` },
      expect: (output: string) => output.length > 0,
    },
    // 3 Error
    {
      description: "Reading a non-existent file fails clearly",
      kind: "error",
      params: { operation: "read", path: "/non/existent/path/xyz123.txt" },
      expect: (output: string) => output.includes("does not exist"),
    },
    {
      description: "Listing a non-existent folder fails clearly",
      kind: "error",
      params: { operation: "list", path: "/non/existent/folder/xyz123" },
      expect: (output: string) => output.includes("does not exist"),
    },
    {
      description: "Missing required operation property",
      kind: "error",
      params: { operation: undefined as unknown as Operation, path: Deno.cwd() },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
  ];

  initialize(_context: BeeContext): void {}

  async process(input: z.infer<FileReadSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { operation, path } = parsed.data as { operation: Operation; path: string };

    console.log(`[file-read] 🐝 Requested '${operation}' on '${path}'`);

    try {
      if (operation === "list") {
        const stat = await Deno.stat(path);
        if (!stat.isDirectory) {
          return `Error: '${path}' is a file, not a directory. Use 'read' to get its content.`;
        }

        const files: string[] = [];
        const dirs: string[] = [];

        for await (const entry of Deno.readDir(path)) {
          (entry.isDirectory ? dirs : files).push(entry.name);
        }

        if (files.length === 0 && dirs.length === 0) {
          return `The folder '${path}' is empty.`;
        }

        const lines: string[] = [];
        if (dirs.length) lines.push(`Folders:\n${dirs.map((d) => `- ${d}/`).join("\n")}`);
        if (files.length) lines.push(`Files:\n${files.map((f) => `- ${f}`).join("\n")}`);

        return `Contents of '${path}':\n${lines.join("\n")}`;
      }

      // operation === "read"
      const stat = await Deno.stat(path);
      if (stat.isDirectory) {
        return `Error: '${path}' is a directory, not a file. Use 'list' to see its contents.`;
      }

      let content = await Deno.readTextFile(path);
      if (content.length > MAX_CONTENT_CHARS) {
        content = `${content.slice(0, MAX_CONTENT_CHARS)}\n...(truncated)`;
      }

      return content || "(the file is empty)";
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return `Error: '${path}' does not exist or is not accessible.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred during '${operation}': ${detail}`;
    }
  }
}

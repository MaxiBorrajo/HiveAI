import { z } from "zod";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

const MAX_CONTENT_CHARS = 20_000;

// Native, read-only filesystem inspection (list a folder's contents, read a text
// file), implemented directly with Deno's fs APIs instead of spawning external
// processes (ls/dir, cat/type). No shell interpreter is ever involved, so there
// is no injection surface, and no OS-specific command needs to be picked.

type Operation = "list" | "read";

export default class FileReadPlugin implements BeePlugin {
  name = "file_read";
  description =
    "Reads the filesystem: 'list' shows the files and folders inside a directory, 'read' returns the text content of a file. Does not modify anything — use file_ops to create/write/copy/move.";

  schema = z.object({
    operation: z
      .enum(["list", "read"])
      .describe("'list' to see a folder's contents, 'read' to get a file's text content."),
    path: z
      .string()
      .describe(
        "Absolute path of the folder to list, or the file to read.",
      ),
  }) as any;

  initialize(_context: BeeContext): void {}

  async process(input: unknown): Promise<string> {
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

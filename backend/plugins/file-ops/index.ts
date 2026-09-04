import { z } from "zod";
import { dirname, join } from "node:path";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

const MAX_CONTENT_CHARS = 50_000;

// Native filesystem operations (create/write/copy/move/mkdir), implemented directly
// with Deno's fs APIs instead of spawning external processes. This avoids the
// portability problems of commands like `touch` (no reliable equivalent on stock
// Windows) and needs no human approval like run_shell does: no shell interpreter
// is ever involved, so there is no injection surface to defend against.
// Deletion is intentionally not supported by this plugin.

type Operation = "create" | "write" | "touch" | "mkdir" | "copy" | "move";

export default class FileOpsPlugin implements BeePlugin {
  name = "file_ops";
  description =
    "Creates, writes, touches, copies, or moves files and folders on disk. Use 'create' or 'write' to make a file with content (write overwrites existing content, create fails if the file already exists), 'touch' to create an empty file or update an existing file's timestamp, 'mkdir' to create a folder, 'copy'/'move' to duplicate or relocate a file or folder. Deletion is not supported by this tool.";

  schema = z.object({
    operation: z
      .enum(["create", "write", "touch", "mkdir", "copy", "move"])
      .describe(
        "The operation to perform: 'create' (new file, fails if exists), 'write' (create or overwrite), 'touch' (empty file or timestamp update), 'mkdir', 'copy', or 'move'.",
      ),
    path: z
      .string()
      .describe(
        "Absolute path of the target file or folder. For 'copy'/'move', this is the source path.",
      ),
    destination: z
      .string()
      .optional()
      .describe("Absolute destination path. Required for 'copy' and 'move'."),
    content: z
      .string()
      .optional()
      .describe(
        "Text content to write. Used by 'create' and 'write'. If omitted, an empty file is created.",
      ),
  }) as any;

  initialize(_context: BeeContext): void {}

  private async ensureParentDir(path: string): Promise<void> {
    await Deno.mkdir(dirname(path), { recursive: true });
  }

  private async copyRecursive(source: string, destination: string): Promise<void> {
    await Deno.mkdir(destination, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
      const srcPath = join(source, entry.name);
      const destPath = join(destination, entry.name);
      if (entry.isDirectory) {
        await this.copyRecursive(srcPath, destPath);
      } else {
        await Deno.copyFile(srcPath, destPath);
      }
    }
  }

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { operation, path, destination, content } = parsed.data as {
      operation: Operation;
      path: string;
      destination?: string;
      content?: string;
    };

    if (content != null && content.length > MAX_CONTENT_CHARS) {
      return `The provided content is too large (${content.length} chars). Maximum allowed is ${MAX_CONTENT_CHARS}.`;
    }

    console.log(`[file-ops] 🐝 Requested '${operation}' on '${path}'${destination ? ` -> '${destination}'` : ""}`);

    try {
      switch (operation) {
        case "create": {
          await this.ensureParentDir(path);
          const file = await Deno.open(path, { write: true, createNew: true });
          file.close();
          if (content) {
            await Deno.writeTextFile(path, content);
          }
          return `Created file: ${path}`;
        }

        case "write": {
          await this.ensureParentDir(path);
          await Deno.writeTextFile(path, content ?? "");
          return `Wrote ${(content ?? "").length} chars to: ${path}`;
        }

        case "touch": {
          await this.ensureParentDir(path);
          try {
            const stat = await Deno.stat(path);
            if (stat.isDirectory) {
              return `Error: '${path}' is a directory, not a file.`;
            }
            const now = new Date();
            await Deno.utime(path, now, now);
            return `Updated timestamp: ${path}`;
          } catch {
            const file = await Deno.open(path, { write: true, createNew: true });
            file.close();
            return `Created file: ${path}`;
          }
        }

        case "mkdir": {
          await Deno.mkdir(path, { recursive: true });
          return `Created folder: ${path}`;
        }

        case "copy": {
          if (!destination) {
            return "Error: 'destination' is required for the 'copy' operation.";
          }
          const stat = await Deno.stat(path);
          if (stat.isDirectory) {
            await this.copyRecursive(path, destination);
            return `Copied folder '${path}' to '${destination}'`;
          }
          await this.ensureParentDir(destination);
          await Deno.copyFile(path, destination);
          return `Copied '${path}' to '${destination}'`;
        }

        case "move": {
          if (!destination) {
            return "Error: 'destination' is required for the 'move' operation.";
          }
          await this.ensureParentDir(destination);
          try {
            await Deno.rename(path, destination);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof Deno.errors.NotSupported || /EXDEV/i.test(message)) {
              return `Error: Cannot move '${path}' to '${destination}' because they are on different drives/filesystems. Use run_shell to copy and then delete the source instead.`;
            }
            throw error;
          }
          return `Moved '${path}' to '${destination}'`;
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        return `Error: '${path}' already exists. Use 'write' to overwrite it.`;
      }
      if (error instanceof Deno.errors.NotFound) {
        return `Error: '${path}' does not exist or is not accessible.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred during '${operation}': ${detail}`;
    }
  }
}

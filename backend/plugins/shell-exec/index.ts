import { z } from "zod";
import type {
  BeePlugin,
  BeeContext,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const MAX_OUTPUT_CHARS = 4000;

// Read, navigation, and file editing commands.
// Anything that deletes (rm, rmdir, del), or executes arbitrary networks/shells (bash, sh, etc) is forbidden.

// cmd.exe builtins: they are not executables themselves, they only exist inside
// a Windows shell. They are invoked as `cmd /c <command> <args>`.
const WINDOWS_BUILTINS = new Set([
  "dir",
  "cd",
  "type",
  "echo",
  "ver",
  "vol",
  "mkdir",
  "copy",
  "move",
]);

// Real executables (have their own .exe / binary in the PATH).
const REAL_EXECUTABLES = new Set([
  // Windows
  "where",
  "whoami",
  "hostname",
  "systeminfo",
  "tasklist",
  // Unix / cross
  "ls",
  "pwd",
  "cat",
  "which",
  "uname",
  "ps",
  "df",
  "du",
  "date",
  "env",
  "find",
  // Editing & Manipulation
  "mkdir",
  "touch",
  "cp",
  "mv",
  "sed",
  "awk",
  "grep",
  "head",
  "tail",
  "tar",
  "zip",
  "unzip",
]);

const ALLOWED_COMMANDS = new Set([...WINDOWS_BUILTINS, ...REAL_EXECUTABLES]);

const schema = z.object({
  command: z
    .string()
    .describe(
      "Name of the command to execute, for example 'ls', 'cat', 'mkdir', 'cp'. Must be an allowed command.",
    ),
  arguments: z
    .array(z.string())
    .default([])
    .describe(
      "List of arguments for the command. Ensure proper argument order (e.g., for sed, the expression comes before the filename: ['-i', 's/a/b/g', 'file.txt']). ALWAYS use '-i' with sed to edit files in-place, since redirection (>) is blocked. DO NOT include the command name. DO NOT wrap arguments in quotes (e.g. use s/a/b/g instead of 's/a/b/g').",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      "Absolute directory path from which to execute the command. MUST BE A FOLDER, NOT A FILE. Target file paths to read/edit must go in the 'arguments' array. If omitted, the process's current directory is used.",
    ),
});

type ShellExecSchema = typeof schema;

export default class ExecuteCommandPlugin implements BeePlugin<ShellExecSchema> {
  name = "execute_command";
  description =
    "Executes a console command to inspect or edit the system (list files, create/move files, edit text, etc). It allows navigation, querying, and file editing/creation from a fixed list of commands. Deletion commands (like rm, rmdir), executing arbitrary shells (like bash, sh), and shell operators (|, >, etc.) are strictly forbidden and will be rejected.";

  schema = schema;

  selectionTests: SelectionTestCase[] = [
    // 3 Positive
    {
      query: "show me the files in this directory using ls",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "display the content of package.json using cat",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "create a new directory named backup with mkdir",
      kind: "positive",
      shouldInvoke: true,
    },
    // 3 Negative
    {
      query: "how many coffees did I drink according to the counter?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "what time is it in Madrid?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "write a TypeScript function to calculate fibonacci",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "delete everything with rm -rf",
      kind: "ambiguous",
    },
    {
      query: "start a web server on port 8080",
      kind: "ambiguous",
    },
    {
      query: "clone the repository from GitHub",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<ShellExecSchema>[] = [
    // 3 Happy
    {
      description: "Execute echo command with argument",
      kind: "happy",
      params: { command: "echo", arguments: ["hello world"] },
      expect: (output: string) => output.includes("hello world"),
    },
    {
      description: "Execute whoami command",
      kind: "happy",
      params: { command: "whoami", arguments: [] },
      expect: (output: string) =>
        output.length > 0 && !output.includes("SECURITY POLICY VIOLATION"),
    },
    {
      description: "Execute pwd to check current working directory",
      kind: "happy",
      params: { command: "pwd", arguments: [] },
      expect: (output: string) =>
        output.length > 0 && !output.toLowerCase().includes("error"),
    },
    // 3 Edge
    {
      description: "Execute command with explicit valid cwd",
      kind: "edge",
      params: { command: "ls", arguments: ["-a"], cwd: Deno.cwd() },
      expect: (output: string) =>
        output.length > 0 && !output.includes("is inaccessible"),
    },
    {
      description: "Execute echo with quotes inside argument that get stripped",
      kind: "edge",
      params: { command: "echo", arguments: ['"testing quotes"'] },
      expect: (output: string) => output.includes("testing quotes"),
    },
    {
      description: "Execute command where first argument repeats command name",
      kind: "edge",
      params: { command: "echo", arguments: ["echo", "test_param"] },
      expect: (output: string) => output.includes("test_param"),
    },
    // 3 Error
    {
      description: "Forbidden command blocked by security firewall (rm)",
      kind: "error",
      params: { command: "rm", arguments: ["-rf", "temp"] },
      expect: (output: string) => output.includes("SECURITY POLICY VIOLATION"),
    },
    {
      description: "Shell operator injection blocked in argument",
      kind: "error",
      params: { command: "echo", arguments: ["hello; ls"] },
      expect: (output: string) =>
        output.includes("forbidden characters") ||
        output.includes("shell operators"),
    },
    {
      description: "Command execution with invalid non-existent cwd",
      kind: "error",
      params: {
        command: "ls",
        arguments: [],
        cwd: "/invalid/nonexistent/directory/path/12345",
      },
      expect: (output: string) =>
        output.includes("does not exist or is inaccessible"),
    },
  ];

  get testCases() {
    return this.selectionTests;
  }

  initialize(_context: BeeContext): void {}

  async process(input: z.infer<ShellExecSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { command: cmd, arguments: args, cwd } = parsed.data;
    const commandName = cmd.trim().toLowerCase();

    // If the model incorrectly passed the command name as the first argument, remove it.
    if (args.length > 0 && args[0].trim().toLowerCase() === commandName) {
      args.shift();
    }

    // Strip surrounding quotes if the model added them (Deno.Command doesn't use a shell)
    for (let i = 0; i < args.length; i++) {
      let arg = args[i].trim();
      if (
        arg.length >= 2 &&
        ((arg.startsWith("'") && arg.endsWith("'")) ||
          (arg.startsWith('"') && arg.endsWith('"')))
      ) {
        args[i] = arg.slice(1, -1);
      }
    }

    console.log(
      `[shell-exec] 🐝 Requested command: '${cmd}' with args: [${args.join(", ")}] (cwd: ${cwd || "default"})`,
    );

    // 1. Extra Validation: Hard blacklist firewall for dangerous operations & argument-based exploits
    // This validation runs independently of the model to absolutely guarantee security.
    const fullCommandStr = [commandName, ...args].join(" ");
    const FORBIDDEN_PATTERNS = [
      /\b(rm|rmdir|del|erase|format|bash|sh|zsh|powershell|pwsh)\b/i, // Deletions and Shells
      /-exec\b/i, // Prevents `find . -exec`
      /system\s*\(/i, // Prevents `awk 'BEGIN{system(...)}'`
      /eval\s*\(/i, // Prevents dynamic eval injections
    ];

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(fullCommandStr)) {
        console.warn(
          `[shell-exec] 🚨 FIREWALL BLOCKED: Pattern ${pattern} matched in "${fullCommandStr}"`,
        );
        return `SECURITY POLICY VIOLATION: The command was blocked by the strict security firewall. Forbidden keywords or patterns (e.g., deletion commands, shells, or execution flags) were detected.`;
      }
    }

    // 2. Shell Operator Injection Check
    for (const arg of args) {
      if (/[;&|`$><]/.test(arg)) {
        console.warn(
          `[shell-exec] 🚨 FIREWALL BLOCKED: Shell operator found in argument "${arg}"`,
        );
        return `The argument '${arg}' contains forbidden characters (shell operators). Arguments must be passed individually, without chaining commands.`;
      }
    }

    // 3. Whitelist Check
    if (!ALLOWED_COMMANDS.has(commandName)) {
      console.warn(
        `[shell-exec] 🚨 WHITELIST BLOCKED: Command '${commandName}' is not permitted.`,
      );
      return `The command '${cmd}' is not allowed. Only the following navigation, query, and file editing commands can be executed: ${Array.from(
        ALLOWED_COMMANDS,
      ).join(", ")}.`;
    }

    const isWindows = Deno.build.os === "windows";
    const useCmdShell = isWindows && WINDOWS_BUILTINS.has(commandName);

    try {
      console.log(`[shell-exec] 🚀 Spawning process: ${commandName}...`);

      if (cwd) {
        try {
          const stat = await Deno.stat(cwd);
          if (!stat.isDirectory) {
            console.warn(
              `[shell-exec] 🚨 INVALID CWD: ${cwd} is not a directory`,
            );
            return `Error: The provided 'cwd' (${cwd}) is a file, not a directory. Target file paths must be passed in the 'arguments' array, not in 'cwd'.`;
          }
        } catch {
          console.warn(`[shell-exec] 🚨 INVALID CWD: ${cwd} does not exist`);
          return `Error: The provided 'cwd' (${cwd}) does not exist or is inaccessible.`;
        }
      }

      const command = useCmdShell
        ? new Deno.Command("cmd", {
            args: ["/d", "/c", commandName, ...args],
            cwd: cwd || undefined,
            stdout: "piped",
            stderr: "piped",
          })
        : new Deno.Command(commandName, {
            args: args,
            cwd: cwd || undefined,
            stdout: "piped",
            stderr: "piped",
          });

      const { code, stdout, stderr } = await command.output();
      console.log(`[shell-exec] 🏁 Command finished with exit code ${code}`);

      const decoder = new TextDecoder();
      let output = decoder.decode(stdout).trim();
      const errorOutput = decoder.decode(stderr).trim();

      if (output.length > MAX_OUTPUT_CHARS) {
        output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n...(output truncated)`;
      }

      if (code !== 0) {
        console.warn(`[shell-exec] ⚠️ Stderr: ${errorOutput}`);
        return `The command '${cmd}' finished with exit code ${code}. Error: ${
          errorOutput || "(no detail)"
        }`;
      }

      return output || "(the command produced no output)";
    } catch (error) {
      console.error(`[shell-exec] ❌ Error throwing command:`, error);
      if (error instanceof Deno.errors.NotFound) {
        const platform = isWindows ? "Windows" : Deno.build.os;
        return `The command '${cmd}' does not exist on this system (${platform}). Available commands: ${Array.from(
          ALLOWED_COMMANDS,
        ).join(", ")}.`;
      }
      return `An error occurred while executing the command: ${(error as Error).message}`;
    }
  }
}

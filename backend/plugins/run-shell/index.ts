import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const MAX_OUTPUT_CHARS = 4000;

function launchBash(command: string): { bin: string; args: string[] } {
  return { bin: "bash", args: ["-c", command] };
}

const schema = z.object({
  command: z
    .string()
    .describe(
      "The full command line to execute, exactly as you would type it into that shell. Can include pipes, redirection, and chaining.",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      "Absolute directory path to run the command from. If omitted, the process's current directory is used.",
    ),
});

type RunShellSchema = typeof schema;

export default class RunShellPlugin implements BeePlugin<RunShellSchema> {
  name = "run_shell";
  description =
    "Executes raw shell commands via bash, with full pipeline and redirection support. USE CASES: the general-purpose fallback for system administration tasks and any external CLI tool (git, npm, python, docker, etc.) — checking memory usage, killing processes, installing packages, version control status/diffs, and anything else a native plugin doesn't cover. A human must approve the command before it runs. Prefer a native plugin only when it fully covers what's being asked; if no native plugin can produce the specific information or action requested, use this tool instead of forcing a native plugin to approximate it.";

  schema = schema;

  selectionTests: SelectionTestCase<RunShellSchema>[] = [
    {
      query: "run 'ls -la | grep .ts' in bash",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "check disk free space with df -h",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "run a command to list running processes sorted by memory",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "what time is it?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "create a file called notes.txt",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "search for a file named report.pdf",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "list the files in this folder",
      kind: "ambiguous",
    },
    {
      query: "show me disk usage",
      kind: "ambiguous",
    },
    {
      query: "count how many .ts files are in the project",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<RunShellSchema>[] = [
    {
      description: "Run a simple echo command via bash",
      kind: "happy",
      params: { command: "echo hello" },
      expect: (output: string) => output.includes("hello"),
    },
    {
      description: "Run a piped command via bash",
      kind: "happy",
      params: { command: "echo hello world | wc -w" },
      expect: (output: string) => output.trim().length > 0,
    },
    {
      description: "Run a command with an explicit valid cwd",
      kind: "happy",
      params: { command: "pwd", cwd: Deno.cwd() },
      expect: (output: string) => output.includes(Deno.cwd()),
    },
    {
      description: "Command producing no output still returns a message",
      kind: "edge",
      params: { command: "true" },
      expect: (output: string) =>
        output.includes("the command produced no output"),
    },
    {
      description: "Command writing to stderr on success is still reported",
      kind: "edge",
      params: { command: "echo warning 1>&2; echo ok" },
      expect: (output: string) =>
        output.includes("ok") && output.includes("stderr: warning"),
    },
    {
      description: "Non-zero exit code is reported with detail",
      kind: "edge",
      params: { command: "exit 3" },
      expect: (output: string) => output.includes("exit code 3"),
    },
    {
      description: "Invalid, non-existent cwd fails clearly",
      kind: "error",
      params: {
        command: "pwd",
        cwd: "/non/existent/directory/path/12345",
      },
      expect: (output: string) =>
        output.includes("does not exist or is inaccessible"),
    },
    {
      description: "cwd pointing to a file, not a directory, fails clearly",
      kind: "error",
      params: { command: "pwd", cwd: `${Deno.cwd()}/deno.json` },
      expect: (output: string) => output.includes("is a file, not a directory"),
    },
    {
      description: "Missing required command property",
      kind: "error",
      params: { command: undefined as unknown as string },
      expect: (output: string) => output.toLowerCase().includes("invalid"),
    },
  ];

  private context!: BeeContext;

  get testCases() {
    return this.selectionTests;
  }

  initialize(context: BeeContext): void {
    this.context = context;
  }

  async process(input: z.infer<RunShellSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { command, cwd } = parsed.data;

    if (cwd) {
      try {
        const stat = await Deno.stat(cwd);
        if (!stat.isDirectory) {
          return `Error: The provided 'cwd' (${cwd}) is a file, not a directory.`;
        }
      } catch {
        return `Error: The provided 'cwd' (${cwd}) does not exist or is inaccessible.`;
      }
    }

    console.log(
      `[run-shell] 🐝 Requesting human approval for [bash]: ${command} (cwd: ${cwd || "default"})`,
    );

    const approved = await this.context.requestApproval(
      "El agente quiere ejecutar un comando",
      `Esta acción usa una shell real (bash), sin restricciones de comandos. Revisá el comando antes de aprobarlo.`,
      { command, ...(cwd ? { cwd } : {}) },
    );

    if (!approved) {
      console.warn(`[run-shell] 🚫 Command was rejected or timed out.`);
      throw new Error(
        "The command was not executed: it was rejected by the user, or no approval response was received in time.",
      );
    }

    console.log(`[run-shell] ✅ Command approved. Executing...`);

    try {
      const resolved = launchBash(command);
      const proc = new Deno.Command(resolved.bin, {
        args: resolved.args,
        cwd: cwd || undefined,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await proc.output();
      console.log(`[run-shell] 🏁 Command finished with exit code ${code}`);

      const decoder = new TextDecoder();
      let output = decoder.decode(stdout).trim();
      const errorOutput = decoder.decode(stderr).trim();

      if (output.length > MAX_OUTPUT_CHARS) {
        output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n...(output truncated)`;
      }

      if (code !== 0) {
        return `The command finished with exit code ${code}. Error: ${
          errorOutput || "(no detail)"
        }`;
      }

      const result = output || "(the command produced no output)";
      return errorOutput ? `${result}\n\n(stderr: ${errorOutput})` : result;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return `The shell 'bash' is not available on this system.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred while executing the command: ${detail}`;
    }
  }
}

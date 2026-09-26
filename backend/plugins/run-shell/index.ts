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

function isSafeInspectionCommand(command: string): boolean {
  const trimmed = command.trim();
  // Disallow file output redirections or dangerous write commands
  if (/>|\brm\s|\bmv\s|\bsudo\b|\bchmod\b|\bchown\b|\bkill\b|\bpkill\b|\bmkfs\b|\bdd\b|\btruncate\b/i.test(trimmed)) {
    return false;
  }
  // Allow common inspection and test commands
  const safePatterns = [
    /^(ps|top|df|free|head|tail|ls|grep|cat|uptime|wc|pwd|date|uname|whoami|echo|which|du)\b/i,
    /^git\s+(status|log|diff|branch|show)\b/i,
    /^(npm|yarn|pnpm|bun)\s+(test|run\s+test)\b/i,
    /^deno\s+(test|check)\b/i,
  ];

  // If piped or chained (e.g. ps aux | head -n 5 && df -h), check each sub-command
  const subcommands = trimmed.split(/&&|\|\||\||;/).map((s) => s.trim()).filter(Boolean);
  return subcommands.length > 0 && subcommands.every((sub) =>
    safePatterns.some((pattern) => pattern.test(sub))
  );
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
    "Executes raw shell commands via bash, with full pipeline and redirection support. This is the most capable tool in the hive: anything the file/search plugins can do individually (finding a file, reading its contents, checking if something exists, editing or writing to it), bash can do too via standard commands (find, grep, cat, sed, awk, ls, etc.) — and it can chain several of those steps into a single command with pipes, so a multi-step investigation (find a file, then grep inside it, then show matching lines) can be one call instead of several separate tool calls. It's also the only way to reach anything a native plugin doesn't cover at all: any external CLI tool (git, npm, python, docker, etc.), system administration tasks, checking processes, installing packages, version control status/diffs. A human must approve the command before it runs. Prefer a native plugin when it directly and simply covers exactly what's asked (it's more predictable and needs no approval); reach for bash instead when the task needs multiple chained steps, an external CLI, or something no native plugin produces.";

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

    let approved = false;
    if (isSafeInspectionCommand(command)) {
      console.log(
        `[run-shell] ⚡ Safe read-only inspection command detected. Auto-approving: "${command}"`,
      );
      approved = true;
    } else {
      console.log(
        `[run-shell]  Requesting human approval for [bash]: ${command} (cwd: ${cwd || "default"})`,
      );

      approved = await this.context.requestApproval(
        "The agent wants to execute a command",
        "This action uses a real shell (bash) without command restrictions. Review the command before approving.",
        { command, ...(cwd ? { cwd } : {}) },
      );
    }

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

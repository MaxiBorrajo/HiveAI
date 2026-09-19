import { z } from "zod";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const MAX_OUTPUT_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 60_000;
// Cap in bytes, applied while the process is still running (not just on the
// final string) — Deno.Command.output() buffers the whole stream in memory
// before returning, so an unbounded producer (`yes`, `cat /dev/zero`) can
// exhaust memory long before MAX_OUTPUT_CHARS ever gets a chance to trim it.
const MAX_STREAM_BYTES = 1_000_000;

// Known-destructive / irreversible patterns. Not a sandbox: the goal is to
// catch the commands a human is most likely to rubber-stamp without reading
// closely (especially when chained after something innocuous).
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(\/|~|\*|\$HOME|\.\.?\/?\s*$)/i, // rm -rf / or ~ or *
  /\bmkfs(\.\w+)?\b/i,
  />\s*\/dev\/(sd|nvme|hd)\w*/i, // overwrite a raw block device
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /\bdd\s+.*\bof=\/dev\//i,
  /curl\s+[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, // curl | sh
  /wget\s+[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bchown\s+-R\s+.*\s+\//i,
  />\s*~\/\.(bash_profile|bashrc|zshrc|ssh\/authorized_keys)\b/i,
];

function findDangerousMatch(command: string): RegExp | undefined {
  return DANGEROUS_PATTERNS.find((pattern) => pattern.test(command));
}

function launchBash(command: string): { bin: string; args: string[] } {
  return { bin: "bash", args: ["-c", command] };
}

// Not a sandbox — the command can still touch any path the OS lets the
// process touch, regardless of cwd (absolute paths, `cd` inside the command
// itself). This only stops the agent from *starting* a command somewhere
// unexpected on the filesystem, same allowed root file-search already uses.
function isWithinAllowedRoot(path: string, root: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(normalizedRoot + sep)
  );
}

// Killing bash's own pid on timeout/abort leaves grandchildren (e.g. `sleep`
// inside `bash -c "sleep 999"`) running orphaned. Killing the whole process
// tree is OS-specific: Windows has no process groups but `taskkill /T` walks
// the tree directly; POSIX has process groups but spawning into one needs
// `setsid`, which isn't available on Git Bash/MSYS2 (this project's bash on
// Windows) — so on non-Windows we fall back to killing bash's pid alone.
async function readStreamCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOverflow: () => void,
): Promise<{ text: string; truncated: boolean }> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const keep = maxBytes - (totalBytes - value.byteLength);
        if (keep > 0) text += decoder.decode(value.slice(0, keep));
        truncated = true;
        onOverflow();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream may already be closed
    }
  }

  return { text, truncated };
}

async function killProcessTree(pid: number): Promise<void> {
  try {
    if (Deno.build.os === "windows") {
      await new Deno.Command("taskkill", {
        args: ["/PID", String(pid), "/T", "/F"],
      }).output();
    } else {
      await new Deno.Command("kill", { args: ["-9", String(pid)] }).output();
    }
  } catch {
    // best-effort: process may have already exited
  }
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
    {
      description: "Known-destructive command is blocked before execution",
      kind: "error",
      params: { command: "rm -rf /" },
      expect: (output: string) => output.includes("blocked"),
    },
    {
      description: "Long-running command is killed after the timeout",
      kind: "edge",
      params: { command: "sleep 999" },
      expect: (output: string) => output.includes("timeout"),
    },
    {
      description: "cwd outside the user's home directory is rejected",
      kind: "error",
      params: { command: "pwd", cwd: "/etc" },
      expect: (output: string) => output.includes("outside the allowed directory"),
    },
    {
      description: "Command producing unbounded output is stopped at the byte cap",
      kind: "edge",
      params: { command: "yes" },
      expect: (output: string) => output.includes("more than") && output.includes("bytes of output"),
    },
  ];

  private context!: BeeContext;

  get testCases() {
    return this.selectionTests;
  }

  initialize(context: BeeContext): void {
    this.context = context;
  }

  async process(
    input: z.infer<RunShellSchema>,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { command, cwd } = parsed.data;

    const dangerousMatch = findDangerousMatch(command);
    if (dangerousMatch) {
      console.warn(
        `[run-shell] 🚫 Blocked command matching dangerous pattern ${dangerousMatch}: ${command}`,
      );
      return `The command was blocked before execution: it matches a known-destructive pattern (${dangerousMatch}). If this was intentional, rephrase it or run it manually outside the agent.`;
    }

    if (cwd) {
      let realCwd: string;
      try {
        realCwd = await Deno.realPath(cwd);
      } catch {
        return `Error: The provided 'cwd' (${cwd}) does not exist or is inaccessible.`;
      }

      const stat = await Deno.stat(realCwd);
      if (!stat.isDirectory) {
        return `Error: The provided 'cwd' (${cwd}) is a file, not a directory.`;
      }

      if (!isWithinAllowedRoot(realCwd, homedir())) {
        return `Error: The provided 'cwd' (${cwd}) is outside the allowed directory (${homedir()}).`;
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

    let killedReason: "timeout" | "aborted" | undefined;
    let timeoutId: number | undefined;
    let onAbort: (() => void) | undefined;

    try {
      const resolved = launchBash(command);
      const child = new Deno.Command(resolved.bin, {
        args: resolved.args,
        cwd: cwd || undefined,
        stdout: "piped",
        stderr: "piped",
      }).spawn();

      timeoutId = setTimeout(() => {
        killedReason = "timeout";
        killProcessTree(child.pid);
      }, DEFAULT_TIMEOUT_MS);

      if (options?.signal) {
        if (options.signal.aborted) {
          killedReason = "aborted";
          killProcessTree(child.pid);
        } else {
          onAbort = () => {
            killedReason = "aborted";
            killProcessTree(child.pid);
          };
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      let stdoutOverflowed = false;
      let stderrOverflowed = false;

      const [stdoutResult, stderrResult, { code }] = await Promise.all([
        readStreamCapped(child.stdout, MAX_STREAM_BYTES, () => {
          stdoutOverflowed = true;
          killProcessTree(child.pid);
        }),
        readStreamCapped(child.stderr, MAX_STREAM_BYTES, () => {
          stderrOverflowed = true;
          killProcessTree(child.pid);
        }),
        child.status,
      ]);

      console.log(`[run-shell] 🏁 Command finished with exit code ${code}`);

      let output = stdoutResult.text.trim();
      const errorOutput = stderrResult.text.trim();

      if (output.length > MAX_OUTPUT_CHARS) {
        output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n...(output truncated)`;
      }

      if (killedReason === "timeout") {
        return `The command was killed for exceeding the ${
          DEFAULT_TIMEOUT_MS / 1000
        }s timeout.`;
      }
      if (killedReason === "aborted") {
        return `The command was aborted before it finished.`;
      }
      if (stdoutOverflowed || stderrOverflowed) {
        return `The command was killed for producing more than ${MAX_STREAM_BYTES} bytes of output.\n\n${output}`;
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
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onAbort && options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  }
}

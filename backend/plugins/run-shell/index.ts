import { z } from "zod";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

const MAX_OUTPUT_CHARS = 4000;

// Real shell execution (bash / cmd / powershell), for anything that needs pipes,
// redirection, chaining, or a command outside of file_ops' fixed set of operations.
// The model supplies a free-form command string that IS interpreted by a shell.
// There is no process sandbox here (no container, no restricted OS user), so
// the only real containment is a human approving the exact command before it
// runs. Approval goes through context.requestApproval() (from BeeContext),
// never a direct import of the microkernel's internals — that's what lets
// this same mechanism work for third-party plugins loaded from outside this
// repo, not just built-in ones.

const SHELL_LAUNCHERS: Record<
  string,
  (command: string) => { bin: string; args: string[] }
> = {
  bash: (command) => ({ bin: "bash", args: ["-c", command] }),
  cmd: (command) => ({ bin: "cmd", args: ["/d", "/c", command] }),
  powershell: (command) => ({
    bin: "powershell",
    args: ["-NoProfile", "-NonInteractive", "-Command", command],
  }),
};

export default class RunShellPlugin implements BeePlugin {
  name = "run_shell";
  description =
    "Runs a real shell command line (bash, cmd, or powershell), supporting pipelines, redirection, chaining, and any command the chosen shell supports — including things file_ops/file_read/file_search can't do (e.g. disk usage/free space, counting files, process info, running arbitrary CLI tools). Because it is not restricted to a fixed set of operations, every single invocation requires explicit human approval before it runs, and will wait (or fail if not approved in time).";

  schema = z.object({
    shell: z
      .enum(["bash", "cmd", "powershell"])
      .describe(
        "Which shell interpreter to run the command with. Pick one available on the current OS (bash/cmd on most systems, powershell on Windows).",
      ),
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
  }) as any;

  private context!: BeeContext;

  initialize(context: BeeContext): void {
    this.context = context;
  }

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { shell, command, cwd } = parsed.data;

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
      `[run-shell] 🐝 Requesting human approval for [${shell}]: ${command} (cwd: ${cwd || "default"})`,
    );

    const approved = await this.context.requestApproval(
      "El agente quiere ejecutar un comando",
      `Esta acción usa una shell real (${shell}), sin restricciones de comandos. Revisá el comando antes de aprobarlo.`,
      { shell, command, ...(cwd ? { cwd } : {}) },
    );

    if (!approved) {
      console.warn(`[run-shell] 🚫 Command was rejected or timed out.`);
      return `The command was NOT executed: it was rejected by the user, or no response was received in time. Do not silently retry — ask the user if they want to proceed differently.`;
    }

    console.log(`[run-shell] ✅ Command approved. Executing...`);

    const launcher = SHELL_LAUNCHERS[shell];

    try {
      const resolved = launcher(command);
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
        return `The shell '${shell}' is not available on this system.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred while executing the command: ${detail}`;
    }
  }
}

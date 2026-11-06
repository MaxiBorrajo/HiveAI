import { assertEquals, assertThrows } from "@std/assert";
import {
  buildProfileArgs,
  cancelEvalJob,
  evalChildCommand,
  getEvalJob,
  startEvalJob,
} from "../../../../modules/models/use-cases/eval-profile-jobs.ts";
import { PROGRESS_PREFIX } from "../../../../tests/llm-eval/progress.ts";

Deno.test("buildProfileArgs - passes the models, keys, categories and confirmation to the runner", () => {
  assertEquals(
    buildProfileArgs({
      executor: { provider: "anthropic", model: "claude-haiku-4-5", keyId: "key-1" },
      judge: { provider: "ollama", model: "lfm2.5" },
      suites: ["routing", "summarization"],
      confirm: true,
    }),
    [
      "--executor=anthropic:claude-haiku-4-5",
      "--categories=routing,summarization",
      "--executor-key=key-1",
      "--judge=lfm2.5",
      "--confirm",
    ],
  );
});

Deno.test("evalChildCommand - runs main.ts through deno in dev, the app binary itself when packaged", () => {
  const dev = evalChildCommand(["--executor=x"], "C:/tools/deno.exe");
  assertEquals(dev.command, "C:/tools/deno.exe");
  assertEquals(dev.args.slice(0, 2), ["run", "-A"]);
  assertEquals(dev.args.at(-2), "eval-profile");
  assertEquals(dev.args[2].endsWith("main.ts"), true);

  const packaged = evalChildCommand(["--executor=x"], "C:/Program Files/HiveAI/HiveAI.exe");
  assertEquals(packaged, { command: "C:/Program Files/HiveAI/HiveAI.exe", args: ["eval-profile", "--executor=x"] });
});

/** A fake child process whose output and exit the test controls. */
function fakeChild() {
  const encoder = new TextEncoder();
  let out!: ReadableStreamDefaultController<Uint8Array>;
  let err!: ReadableStreamDefaultController<Uint8Array>;
  let exit!: (status: Deno.CommandStatus) => void;
  let killed = false;
  const child = {
    stdout: new ReadableStream<Uint8Array>({ start: (c) => void (out = c) }),
    stderr: new ReadableStream<Uint8Array>({ start: (c) => void (err = c) }),
    status: new Promise<Deno.CommandStatus>((r) => (exit = r)),
    kill: () => {
      killed = true;
      finish(1);
    },
  } as unknown as Deno.ChildProcess;
  function finish(code: number) {
    out.close();
    err.close();
    exit({ success: code === 0, code, signal: null });
  }
  return {
    child,
    write: (line: string) => out.enqueue(encoder.encode(line + "\n")),
    progress: (event: unknown) => out.enqueue(encoder.encode(PROGRESS_PREFIX + JSON.stringify(event) + "\n")),
    finish,
    wasKilled: () => killed,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

Deno.test("startEvalJob - tracks progress and saved suites from the child's output", async () => {
  const fake = fakeChild();
  const job = startEvalJob(
    { executor: { provider: "ollama", model: "__job-test-1__" }, suites: ["routing", "execution"], confirm: false },
    () => fake.child,
  );
  assertEquals(job.status, "running");

  fake.progress({ type: "case-start", suite: "routing", index: 2, total: 17, name: "picks counter" });
  fake.write("Running: picks counter");
  await settle();
  assertEquals(getEvalJob("__job-test-1__")?.current, { suite: "routing", index: 2, total: 17, name: "picks counter" });

  fake.progress({ type: "suite-saved", suite: "routing" });
  fake.finish(0);
  await settle();
  const done = getEvalJob("__job-test-1__")!;
  assertEquals(done.status, "succeeded");
  assertEquals(done.savedSuites, ["routing"]);
  assertEquals(done.current, undefined);
  assertEquals(done.log, ["Running: picks counter"]);
});

Deno.test("startEvalJob - refuses a second run of the same model while one is running", () => {
  const fake = fakeChild();
  const opts = { executor: { provider: "ollama" as const, model: "__job-test-2__" }, suites: ["routing" as const], confirm: false };
  startEvalJob(opts, () => fake.child);
  assertThrows(() => startEvalJob(opts, () => fakeChild().child), Error, "already running");
  fake.finish(0);
});

Deno.test("cancelEvalJob - kills the child, keeps already-saved suites and marks the run cancelled", async () => {
  const fake = fakeChild();
  startEvalJob(
    { executor: { provider: "ollama", model: "__job-test-3__" }, suites: ["routing", "generation"], confirm: false },
    () => fake.child,
  );
  fake.progress({ type: "suite-saved", suite: "routing" });
  await settle();

  const job = cancelEvalJob("__job-test-3__")!;
  await settle();
  assertEquals(fake.wasKilled(), true);
  assertEquals(job.status, "cancelled");
  assertEquals(getEvalJob("__job-test-3__")?.savedSuites, ["routing"]);
});

Deno.test("startEvalJob - a child that exits with an error marks the run failed", async () => {
  const fake = fakeChild();
  startEvalJob(
    { executor: { provider: "ollama", model: "__job-test-4__" }, suites: ["routing"], confirm: false },
    () => fake.child,
  );
  fake.write("Profiling 'routing' failed (boom).");
  fake.finish(1);
  await settle();
  const job = getEvalJob("__job-test-4__")!;
  assertEquals(job.status, "failed");
  assertEquals(job.log.at(-1), "Profiling 'routing' failed (boom).");
});

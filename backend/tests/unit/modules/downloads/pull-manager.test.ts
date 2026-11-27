import { assert, assertEquals } from "@std/assert";
import {
  PullManager,
  type PullClient,
  type PullProgress,
} from "../../../../modules/downloads/lib/pull-manager.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Fake Ollama pull: yields scripted events, can block or fail. */
function fakeClient(opts: {
  events?: PullProgress[];
  failWith?: Error;
  gate?: Promise<void>;
  onAbort?: () => void;
}): PullClient {
  let aborted = false;
  const iterator = {
    abort() {
      aborted = true;
      opts.onAbort?.();
    },
    async *[Symbol.asyncIterator]() {
      for (const e of opts.events ?? []) {
        yield e;
        if (opts.gate) await opts.gate;
        if (aborted) throw new DOMException("aborted", "AbortError");
      }
      if (opts.failWith) throw opts.failWith;
    },
  };
  return {
    pull: () => Promise.resolve(iterator),
    abort: () => iterator.abort(),
  };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
}

const layer = (completed: number, digest = "sha:a", total = 100): PullProgress => ({
  status: "pulling",
  digest,
  total,
  completed,
});

Deno.test("PullManager - downloads, reports progress and completes with capabilities", async () => {
  let t = 0;
  const manager = new PullManager({
    now: () => (t += 1000),
    createClient: () => fakeClient({ events: [layer(0), layer(50), layer(100), { status: "success" }] }),
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
    onCompleted: () => Promise.resolve(["tools", "vision"]),
  });
  const seen: number[] = [];
  manager.subscribe((e) => {
    if (e.type === "update") seen.push(e.download.completed);
  });
  const d = manager.enqueue("gemma3n:e4b");
  await settle();
  const done = manager.list().find((x) => x.id === d.id)!;
  assertEquals(done.status, "completed");
  assertEquals(done.capabilities, ["tools", "vision"]);
  assert(seen.includes(50));
  assertEquals(done.completed, 100);
});

Deno.test("PullManager - aggregates layers and computes speed", async () => {
  let t = 0;
  const gate = deferred();
  const manager = new PullManager({
    now: () => (t += 1000),
    createClient: () =>
      fakeClient({ events: [layer(0, "a", 100), layer(0, "b", 300), layer(100, "a", 100), layer(200, "b", 300)], gate: gate.promise }),
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  const d = manager.enqueue("m");
  await settle();
  const cur = manager.list().find((x) => x.id === d.id)!;
  assertEquals(cur.total, 100);
  assertEquals(cur.completed, 0);
  gate.resolve();
  await settle();
  const after = manager.list().find((x) => x.id === d.id)!;
  assertEquals(after.total, 400);
  assertEquals(after.completed, 400);
  assert(after.bytesPerSec >= 0);
  assert(after.status === "completed");
});

Deno.test("PullManager - respects max parallel and starts queued ones later", async () => {
  const gate = deferred();
  let started = 0;
  const manager = new PullManager({
    maxParallel: 2,
    createClient: () => {
      started++;
      return fakeClient({ events: [layer(1)], gate: gate.promise });
    },
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  manager.enqueue("a");
  manager.enqueue("b");
  const c = manager.enqueue("c");
  await settle();
  assertEquals(started, 2);
  assertEquals(manager.list().find((x) => x.id === c.id)!.status, "queued");
  gate.resolve();
  await settle();
  assertEquals(started, 3);
  assert(manager.list().every((x) => x.status === "completed"));
});

Deno.test("PullManager - does not enqueue the same active name twice", async () => {
  const gate = deferred();
  const manager = new PullManager({
    createClient: () => fakeClient({ events: [layer(1)], gate: gate.promise }),
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  const a = manager.enqueue("x:1");
  const b = manager.enqueue(" x:1 ");
  assertEquals(a.id, b.id);
  assertEquals(manager.list().length, 1);
  gate.resolve();
  await settle();
});

Deno.test("PullManager - cancel aborts only that download and leaves no listed partial model", async () => {
  const gate = deferred();
  const deleted: string[] = [];
  let installed: string[] = [];
  let abortedA = false;
  let abortedB = false;
  const manager = new PullManager({
    createClient: (() => {
      let n = 0;
      return () => {
        const isA = n++ === 0;
        return fakeClient({
          events: [layer(1), layer(2)],
          gate: gate.promise,
          onAbort: () => (isA ? (abortedA = true) : (abortedB = true)),
        });
      };
    })(),
    listInstalled: () => Promise.resolve(installed),
    deleteModel: (n) => {
      deleted.push(n);
      installed = installed.filter((x) => x !== n);
      return Promise.resolve();
    },
  });
  const a = manager.enqueue("a");
  const b = manager.enqueue("b");
  await settle();
  installed = ["a"]; // simulate a partial entry appearing
  manager.cancel(a.id);
  gate.resolve();
  await settle();
  assert(abortedA);
  assert(!abortedB);
  assertEquals(manager.list().find((x) => x.id === a.id)!.status, "cancelled");
  assertEquals(manager.list().find((x) => x.id === b.id)!.status, "completed");
  assertEquals(deleted, ["a"]);
  assert(!installed.includes("a"));
});

Deno.test("PullManager - cancelling a re-download never deletes an already installed model", async () => {
  const gate = deferred();
  const deleted: string[] = [];
  const manager = new PullManager({
    createClient: () => fakeClient({ events: [layer(1), layer(2)], gate: gate.promise }),
    listInstalled: () => Promise.resolve(["a"]),
    deleteModel: (n) => {
      deleted.push(n);
      return Promise.resolve();
    },
  });
  const a = manager.enqueue("a");
  await settle();
  manager.cancel(a.id);
  gate.resolve();
  await settle();
  assertEquals(deleted, []);
});

Deno.test("PullManager - cancels a queued download without starting it", async () => {
  const gate = deferred();
  let started = 0;
  const manager = new PullManager({
    maxParallel: 1,
    createClient: () => {
      started++;
      return fakeClient({ events: [layer(1)], gate: gate.promise });
    },
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  manager.enqueue("a");
  const b = manager.enqueue("b");
  await settle();
  manager.cancel(b.id);
  gate.resolve();
  await settle();
  assertEquals(started, 1);
  assertEquals(manager.list().find((x) => x.id === b.id)!.status, "cancelled");
});

Deno.test("PullManager - failures are mapped and can be retried", async () => {
  let attempt = 0;
  const manager = new PullManager({
    createClient: () =>
      attempt++ === 0
        ? fakeClient({ events: [layer(10)], failWith: new Error("dial tcp: lookup registry.ollama.ai: no such host") })
        : fakeClient({ events: [layer(100), { status: "success" }] }),
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  const d = manager.enqueue("m");
  await settle();
  const failed = manager.list().find((x) => x.id === d.id)!;
  assertEquals(failed.status, "failed");
  assertEquals(failed.errorKind, "network");
  manager.retry(d.id);
  await settle();
  const ok = manager.list().find((x) => x.id === d.id)!;
  assertEquals(ok.status, "completed");
  assertEquals(ok.error, undefined);
});

Deno.test("PullManager - unknown model name is reported as not found", async () => {
  const manager = new PullManager({
    createClient: () => fakeClient({ failWith: new Error("pull model manifest: file does not exist") }),
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  const d = manager.enqueue("nope:1b");
  await settle();
  const x = manager.list().find((i) => i.id === d.id)!;
  assertEquals(x.errorKind, "not_found");
  assert(x.error!.includes("nope:1b"));
});

Deno.test("PullManager - subscribers get a snapshot first and can unsubscribe", () => {
  const manager = new PullManager({
    createClient: () => fakeClient({}),
    listInstalled: () => Promise.resolve([]),
    deleteModel: () => Promise.resolve(),
  });
  const events: string[] = [];
  const off = manager.subscribe((e) => events.push(e.type));
  assertEquals(events[0], "snapshot");
  off();
  manager.enqueue("z");
  assertEquals(events.length, 1);
});

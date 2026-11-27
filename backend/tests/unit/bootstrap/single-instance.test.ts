import { assertEquals } from "@std/assert";
import { join } from "node:path";

// A second launch is a different process, so test it as one.
const SCRIPT = `
import { claimInstance } from ${JSON.stringify(new URL("../../../bootstrap/single-instance.ts", import.meta.url).href)};
const claim = await claimInstance(Deno.args[0]);
if (!claim.acquired) { console.log("second"); Deno.exit(0); }
const server = Deno.serve({ port: 0, onListen() {} }, () => new Response("shown"));
claim.publishPort(server.addr.port);
console.log("owner");
await new Promise((r) => setTimeout(r, 60000));
`;

async function launch(dir: string, dataDir: string) {
  const script = join(dir, `inst-${crypto.randomUUID()}.ts`);
  await Deno.writeTextFile(script, SCRIPT);
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", script, dataDir],
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
}

async function firstLine(p: Deno.ChildProcess) {
  const reader = p.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return value?.trim();
}

Deno.test("a second launch defers to a live owner, and takes over from a dead one", async () => {
  const dir = await Deno.makeTempDir();
  const dataDir = join(dir, "data");

  const first = await launch(dir, dataDir);
  assertEquals(await firstLine(first), "owner");

  const second = await launch(dir, dataDir);
  assertEquals(await firstLine(second), "second");
  await second.status;

  first.kill();
  await first.status;

  const third = await launch(dir, dataDir);
  assertEquals(await firstLine(third), "owner", "stale instance.json must not block a new start");
  third.kill();
  await third.status;
});

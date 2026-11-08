import { join } from "node:path";

/**
 * Two processes would run two schedulers over the same database and fire every
 * schedule twice, so only one app instance may run per data directory.
 *
 * Deno has no non-blocking file lock, so the owner publishes its port in
 * `instance.json` and a newcomer treats the owner as alive only if it answers.
 * A crashed owner leaves a stale file that simply fails to answer.
 */
export type InstanceClaim = {
  acquired: true;
  publishPort(port: number): void;
} | { acquired: false };

const STARTUP_WAIT_MS = 10_000;
const FRESH_MS = 15_000;

interface InstanceFile {
  port: number | null;
  pid: number;
  startedAt: number;
}

function readInstance(path: string): InstanceFile | null {
  try {
    return JSON.parse(Deno.readTextFileSync(path));
  } catch {
    return null;
  }
}

/** Asks the running instance to bring its window forward. */
async function pingOwner(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/app/show`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

async function ownerIsAlive(path: string): Promise<boolean> {
  let info = readInstance(path);
  const deadline = Date.now() + STARTUP_WAIT_MS;
  // An owner that is still booting has written its pid but not its port yet.
  while (
    info && info.port === null && Date.now() - info.startedAt < FRESH_MS &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 250));
    info = readInstance(path);
  }
  return info?.port ? await pingOwner(info.port) : false;
}

export async function claimInstance(dataDir: string): Promise<InstanceClaim> {
  Deno.mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "instance.json");

  if (await ownerIsAlive(path)) return { acquired: false };

  const write = (port: number | null) =>
    Deno.writeTextFileSync(
      path,
      JSON.stringify({ port, pid: Deno.pid, startedAt: Date.now() }),
    );
  write(null);
  return { acquired: true, publishPort: write };
}

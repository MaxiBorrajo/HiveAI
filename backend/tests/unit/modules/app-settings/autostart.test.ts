import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import {
  isAutostartEnabled,
  linuxEntryContents,
  setAutostart,
} from "../../../../modules/app-settings/autostart.ts";

async function linuxEnv() {
  const home = await Deno.makeTempDir();
  return { os: "linux" as const, home, execPath: "/opt/Hive AI/hive-ai" };
}

Deno.test("linux autostart writes a .desktop entry that launches hidden", async () => {
  const env = await linuxEnv();
  assertEquals(await isAutostartEnabled(env), false);

  await setAutostart(true, env);
  assertEquals(await isAutostartEnabled(env), true);

  const entry = await Deno.readTextFile(join(env.home, ".config/autostart/hiveai.desktop"));
  assertStringIncludes(entry, 'Exec="/opt/Hive AI/hive-ai" --hidden');
  assertEquals(entry, linuxEntryContents(env.execPath));
});

Deno.test("linux autostart honours XDG_CONFIG_HOME and can be removed twice", async () => {
  const env = { ...(await linuxEnv()), configHome: await Deno.makeTempDir() };
  await setAutostart(true, env);
  assertEquals((await Deno.stat(join(env.configHome, "autostart/hiveai.desktop"))).isFile, true);

  await setAutostart(false, env);
  await setAutostart(false, env);
  assertEquals(await isAutostartEnabled(env), false);
});

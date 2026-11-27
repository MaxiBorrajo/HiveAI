import { join } from "node:path";
import { homeDir } from "../../core/env.ts";

/** Flag the OS launcher passes so the app starts in the tray. */
export const HIDDEN_FLAG = "--hidden";

const LINUX_ENTRY = "hiveai.desktop";
const WINDOWS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const WINDOWS_VALUE = "HiveAI";

export interface AutostartEnv {
  os: typeof Deno.build.os;
  home: string;
  execPath: string;
  /** XDG_CONFIG_HOME, when set. */
  configHome?: string;
}

export function linuxEntryPath(env: AutostartEnv): string {
  return join(env.configHome || join(env.home, ".config"), "autostart", LINUX_ENTRY);
}

export function linuxEntryContents(execPath: string): string {
  // Exec values are space-split, so quote the path.
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=HiveAI",
    `Exec="${execPath}" ${HIDDEN_FLAG}`,
    "X-GNOME-Autostart-enabled=true",
    "Terminal=false",
    "",
  ].join("\n");
}

function defaultEnv(): AutostartEnv {
  return {
    os: Deno.build.os,
    home: homeDir,
    execPath: Deno.execPath(),
    configHome: Deno.env.get("XDG_CONFIG_HOME"),
  };
}

async function reg(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const out = await new Deno.Command("reg", { args, stdout: "piped", stderr: "piped" })
    .output();
  return { ok: out.success, stdout: new TextDecoder().decode(out.stdout) };
}

export async function isAutostartEnabled(
  env: AutostartEnv = defaultEnv(),
): Promise<boolean> {
  if (env.os === "linux") {
    try {
      await Deno.stat(linuxEntryPath(env));
      return true;
    } catch {
      return false;
    }
  }
  if (env.os === "windows") {
    return (await reg(["query", WINDOWS_KEY, "/v", WINDOWS_VALUE])).ok;
  }
  return false;
}

export async function setAutostart(
  enabled: boolean,
  env: AutostartEnv = defaultEnv(),
): Promise<void> {
  if (env.os === "linux") {
    const path = linuxEntryPath(env);
    if (!enabled) {
      await Deno.remove(path).catch((e) => {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      });
      return;
    }
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, linuxEntryContents(env.execPath));
    return;
  }
  if (env.os === "windows") {
    const result = enabled
      ? await reg([
        "add", WINDOWS_KEY, "/v", WINDOWS_VALUE, "/t", "REG_SZ", "/d",
        `"${env.execPath}" ${HIDDEN_FLAG}`, "/f",
      ])
      : await reg(["delete", WINDOWS_KEY, "/v", WINDOWS_VALUE, "/f"]);
    if (!result.ok && enabled) throw new Error("Could not update the Windows startup entry.");
    return;
  }
  throw new Error("Launching at login is not supported on this platform yet.");
}

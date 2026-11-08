import { join } from "node:path";

/** Diagnostics for things only visible in the installed app. */
export function desktopLog(message: string): void {
  console.log(`[desktop] ${message}`);
  try {
    const dir = join(Deno.env.get("HOME") ?? ".", ".hiveai");
    Deno.writeTextFileSync(join(dir, "desktop.log"), `${new Date().toISOString()} ${message}\n`, {
      append: true,
    });
  } catch {
    // diagnostics only
  }
}

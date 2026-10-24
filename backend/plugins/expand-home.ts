import { join } from "node:path";

export function expandHome(path: string): string {
  if (path !== "~" && !path.startsWith("~/") && !path.startsWith("~\\")) return path;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  return home ? join(home, path.slice(1)) : path;
}

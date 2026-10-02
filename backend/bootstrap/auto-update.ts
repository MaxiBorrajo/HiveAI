import { setReadyVersion } from "../modules/app-updates/lib/update-state.ts";

// The updater refuses HTTP redirects, and GitHub release downloads always redirect,
// so the update files are served from a branch through raw.githubusercontent.com.
const UPDATES_URL = "https://raw.githubusercontent.com/MaxiBorrajo/HiveAI/updates";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startAutoUpdate(): void {
  // Only Linux publishes update channels: Windows cannot apply patches (Deno
  // cannot swap the loaded DLL) and macOS builds are not published.
  if (!Deno.desktopVersion || Deno.build.os !== "linux") return;

  Deno.autoUpdate({
    url: `${UPDATES_URL}/${Deno.build.os}-${Deno.build.arch}`,
    interval: CHECK_INTERVAL_MS,
    onUpdateReady: (version: string) => {
      console.log(`Update ${version} downloaded; it applies on next launch.`);
      setReadyVersion(version);
    },
    onRollback: (reason: unknown) => {
      console.warn("Previous launch failed; rolled back:", reason);
    },
  });
}

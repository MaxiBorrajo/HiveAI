import { setReadyVersion } from "../modules/app-updates/lib/update-state.ts";

const RELEASES_URL = "https://github.com/MaxiBorrajo/HiveAI/releases/download";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startAutoUpdate(): void {
  // Only Linux publishes update channels: Windows cannot apply patches (Deno
  // cannot swap the loaded DLL) and macOS builds are not published.
  if (!Deno.desktopVersion || Deno.build.os !== "linux") return;

  Deno.autoUpdate({
    url: `${RELEASES_URL}/updates-${Deno.build.os}-${Deno.build.arch}`,
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

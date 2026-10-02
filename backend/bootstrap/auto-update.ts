import { setReadyVersion } from "../modules/app-updates/lib/update-state.ts";

const RELEASES_URL = "https://github.com/MaxiBorrajo/HiveAI/releases/download";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startAutoUpdate(): void {
  if (!Deno.desktopVersion || Deno.build.os === "windows") return;

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

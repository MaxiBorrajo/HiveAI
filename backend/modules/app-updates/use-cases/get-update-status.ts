import { ResponseBuilder } from "../../../core/api/response.ts";
import { isNewerVersion } from "../lib/version.ts";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/MaxiBorrajo/HiveAI/releases/latest";
const CACHE_MS = 60 * 60 * 1000;
const FAILURE_CACHE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

const INSTALLER_EXTENSION: Record<string, string> = {
  linux: ".deb",
  windows: ".msi",
};

interface LatestRelease {
  version: string;
  downloadUrl: string;
}

export interface UpdateStatus {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
}

let cache: { release: LatestRelease | null; expiresAt: number } | null = null;

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.release;

  let release: LatestRelease | null = null;
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const data = await response.json() as {
        tag_name: string;
        html_url: string;
        assets: { name: string; browser_download_url: string }[];
      };
      const extension = INSTALLER_EXTENSION[Deno.build.os];
      const installer = data.assets.find((a) => extension && a.name.endsWith(extension));
      release = {
        version: data.tag_name.replace(/^v/, ""),
        downloadUrl: installer?.browser_download_url ?? data.html_url,
      };
    }
  } catch {
  }

  cache = { release, expiresAt: Date.now() + (release ? CACHE_MS : FAILURE_CACHE_MS) };
  return release;
}

export async function getUpdateStatus(
  headers: Record<string, string>,
): Promise<Response> {
  const currentVersion =
    Deno.env.get("HIVEAI_VERSION_OVERRIDE") ?? Deno.desktopVersion ?? null;

  const release = currentVersion ? await fetchLatestRelease() : null;
  const status: UpdateStatus = {
    currentVersion,
    latestVersion: release?.version ?? null,
    updateAvailable: !!(release && currentVersion && isNewerVersion(currentVersion, release.version)),
    downloadUrl: release?.downloadUrl ?? null,
  };
  return ResponseBuilder.success(status, { headers });
}

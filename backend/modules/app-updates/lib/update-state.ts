// Version of an update that was downloaded and will be applied on next launch.
let readyVersion: string | null = null;

export function setReadyVersion(version: string): void {
  readyVersion = version;
}

export function getReadyVersion(): string | null {
  return readyVersion;
}

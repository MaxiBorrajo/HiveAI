/** Lets HTTP handlers reach the native window owned by bootstrap/desktop.ts. */
export interface AppWindowControls {
  show(): void;
}

let controls: AppWindowControls | undefined;

export function setAppWindowControls(next: AppWindowControls): void {
  controls = next;
}

export function showAppWindow(): boolean {
  if (!controls) return false;
  controls.show();
  return true;
}

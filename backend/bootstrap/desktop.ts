import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setAppWindowControls } from "../modules/app-settings/window-controls.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DesktopOptions {
  /** Started by the OS at login: keep the window out of the way. */
  startHidden: boolean;
  /** Read at close time, so the user can change it while the app runs. */
  runInBackground: () => boolean;
}

function loadTrayIcon(): Uint8Array | null {
  const candidates = [
    join(__dirname, "../../frontend/dist/icons/app.png"),
    join(__dirname, "../../frontend/public/icons/app.png"),
  ];
  for (const path of candidates) {
    try {
      return Deno.readFileSync(path);
    } catch {
      // try the next location
    }
  }
  return null;
}

function createTray(onOpen: () => void): Deno.Tray | null {
  try {
    const icon = loadTrayIcon();
    if (!icon) return null;
    const tray = new Deno.Tray();
    // trayId 0 = the platform could not create it (e.g. no AppIndicator).
    if (tray.trayId === 0) return null;
    tray.setIcon(icon);
    tray.setTooltip("HiveAI");
    tray.setMenu([
      { item: { label: "Open HiveAI", id: "open", enabled: true } },
      "separator",
      { item: { label: "Quit", id: "quit", enabled: true } },
    ]);
    tray.addEventListener("click", onOpen);
    tray.addEventListener("menuclick", (event) => {
      if (event.detail.id === "open") onOpen();
      if (event.detail.id === "quit") Deno.exit(0);
    });
    return tray;
  } catch (error) {
    console.error("Could not create the tray icon:", error);
    return null;
  }
}

export function openDesktopWindow(port: number, options: DesktopOptions): void {
  if (!Deno.BrowserWindow) {
    console.log(
      "Tip: Run with 'deno desktop backend/main.ts' to open as a desktop app.",
    );
    return;
  }

  const win = new Deno.BrowserWindow({
    title: "HiveAI",
    width: 1200,
    height: 800,
    resizable: true,
  });
  win.navigate?.(`http://localhost:${port}`);

  const show = () => {
    win.show();
    win.focus();
  };
  setAppWindowControls({ show });

  const tray = createTray(show);

  // Only hide on close when there is a tray to get it back from; otherwise
  // the app would keep running with no way to reach it.
  win.addEventListener("close", (event) => {
    if (tray && options.runInBackground()) {
      event.preventDefault();
      win.hide();
    }
  });

  try {
    Deno.dock?.addEventListener("reopen", show);
  } catch {
    // macOS only
  }

  if (options.startHidden && tray) win.hide();

  console.log("Desktop window opened.");
}

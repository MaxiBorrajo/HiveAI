import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopLog } from "./desktop-log.ts";
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
    if (tray.trayId === 0) {
      console.log(
        "[desktop] No system tray available. HiveAI still keeps running when " +
          "its window is closed; launch it again to bring the window back.",
      );
      return null;
    }
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

  const url = `http://localhost:${port}`;
  const log = desktopLog;

  let win: Deno.BrowserWindow;
  let tray: Deno.Tray | null = null;

  // The first window adopts the implicit startup window; later ones are new.
  const openWindow = (): Deno.BrowserWindow => {
    const created = new Deno.BrowserWindow({
      title: "HiveAI",
      width: 1200,
      height: 800,
      resizable: true,
    });
    created.navigate?.(url);
    // Closing hides it; scheduled runs keep going.
    created.addEventListener("close", (event) => {
      log("close event received");
      try {
        const keep = options.runInBackground();
        log(`runInBackground=${keep}, cancelable=${event.cancelable}`);
        if (!keep) return log("Quitting (background mode is off).");
        // The close cannot be cancelled in this webview (cancelable=false) and
        // calling hide() from inside the handler never returns. The window is
        // destroyed and show() opens a new one; the process keeps running.
        setTimeout(() => {
          try {
            log(`after close: isClosed=${created.isClosed()}`);
          } catch (error) {
            log(`after close check failed: ${error}`);
          }
        }, 300);
      } catch (error) {
        log(`close handler failed: ${error instanceof Error ? error.stack : error}`);
      }
    });
    return created;
  };

  win = openWindow();

  // The runtime exits when no window is open, and a close cannot be cancelled
  // here. A tiny hidden window keeps the process (and the scheduler) alive
  // after the user closes the real one; show() opens a fresh window.
  try {
    const keeper = new Deno.BrowserWindow({
      title: "HiveAI (background)",
      width: 100,
      height: 100,
      noActivate: true,
      resizable: false,
    });
    keeper.hide();
    log("Background keeper window ready.");
  } catch (error) {
    log(`Could not create the background keeper window: ${error}`);
  }

  const show = () => {
    // If the OS destroyed the window without a cancelable close, open a new one.
    if (win.isClosed()) {
      log("Window was destroyed; opening a new one.");
      win = openWindow();
    }
    win.show();
    win.focus();
  };
  setAppWindowControls({ show });

  tray = createTray(show);

  // Safety net: the window vanished and nothing hid it (no close event).
  let reported = false;
  setInterval(() => {
    if (!win.isClosed()) {
      reported = false;
      return;
    }
    if (options.runInBackground()) {
      if (!reported) {
        reported = true;
        log("Window closed without a close event; staying in the background.");
      }
    } else {
      log("Window closed; quitting (background mode is off).");
      Deno.exit(0);
    }
  }, 2000);

  try {
    Deno.dock?.addEventListener("reopen", show);
  } catch {
    // macOS only
  }

  if (options.startHidden) win.hide();

  console.log("Desktop window opened.");
}

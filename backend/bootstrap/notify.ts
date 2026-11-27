import { showAppWindow } from "../modules/app-settings/window-controls.ts";
import { desktopLog } from "./desktop-log.ts";

/**
 * Native notification. On Linux we call the desktop's notification service
 * (org.freedesktop.Notifications) through `gdbus`, which ships with GNOME: the
 * web Notification API showed nothing there and `notify-send` is not always
 * installed. Elsewhere the web API is used.
 */
export function notifyUser(title: string, body: string): void {
  if (Deno.build.os === "linux") {
    sendWithGdbus(title, body).then((sent) => {
      if (!sent) sendWithWebApi(title, body);
    });
    return;
  }
  sendWithWebApi(title, body);
}

/** GVariant text syntax: a single-quoted string. */
function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n")}'`;
}

async function sendWithGdbus(title: string, body: string): Promise<boolean> {
  try {
    const { code, stdout, stderr } = await new Deno.Command("gdbus", {
      args: [
        "call",
        "--session",
        "--dest=org.freedesktop.Notifications",
        "--object-path=/org/freedesktop/Notifications",
        "--method=org.freedesktop.Notifications.Notify",
        "HiveAI", // app name
        "0", // replaces id
        "'hiveai'", // icon: the theme icon the .deb installs
        quote(title),
        quote(body),
        "[]", // actions
        "{}", // hints (no desktop-entry: GNOME then applies per-app settings that can hide it)
        "10000", // timeout ms
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (code === 0) {
      desktopLog(`Notification sent: ${new TextDecoder().decode(stdout).trim()}`);
      return true;
    }
    desktopLog(`gdbus notify failed (${code}): ${new TextDecoder().decode(stderr).trim()}`);
  } catch (error) {
    desktopLog(`gdbus unavailable: ${error}`);
  }
  return false;
}

function sendWithWebApi(title: string, body: string): void {
  try {
    desktopLog(`Web Notification (permission: ${Notification.permission})`);
    const notification = new Notification(title, { body });
    notification.addEventListener("click", () => showAppWindow());
    notification.addEventListener("error", () => desktopLog("Web Notification error."));
  } catch (error) {
    desktopLog(`Web Notification failed: ${error}`);
  }
}

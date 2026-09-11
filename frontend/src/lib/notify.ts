// Fires a desktop notification when a chat response finishes while the
// window isn't focused or the user is looking at a different chat. Works
// both in a regular browser tab (dev mode) and in `deno desktop`, which
// implements the same Web Notifications API.
export function isWindowFocused(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

// Must be called from a real user gesture (e.g. submitting a message) —
// browsers and deno desktop's webview silently refuse to show the OS
// permission prompt when requestPermission() is called from an async
// callback like a stream event instead.
export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    console.warn("[notify] Notification API not available in this runtime");
    return;
  }

  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return;
  }

  const result = await Notification.requestPermission();
  console.warn("[notify] permission request result:", result);
}

export function notifyChatResponse(title: string, body: string) {
  if (typeof Notification === "undefined") {
    console.warn("[notify] Notification API not available in this runtime");
    return;
  }

  if (Notification.permission !== "granted") {
    console.warn(
      "[notify] skipped, permission is:",
      Notification.permission,
    );
    return;
  }

  const notification = new Notification(title, {
    body,
    tag: "hiveai-chat-response",
  });

  notification.addEventListener("click", () => {
    window.focus();
    notification.close();
  });
}

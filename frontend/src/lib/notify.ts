export function isWindowFocused(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    console.warn("[notify] Notification API not available in this runtime");
    return;
  }

  if (
    Notification.permission === "granted" ||
    Notification.permission === "denied"
  ) {
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
    console.warn("[notify] skipped, permission is:", Notification.permission);
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

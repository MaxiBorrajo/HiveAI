export function openDesktopWindow(port: number): void {
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

  console.log("Desktop window opened.");
}

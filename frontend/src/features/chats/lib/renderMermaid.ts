type Mermaid = typeof import("mermaid").default;

// About 1 MB: loaded the first time a diagram shows up, not with the app.
let loading: Promise<Mermaid> | null = null;
let nextId = 0;

/** The diagram as SVG markup. Strict mode sanitizes it and allows no scripts or clicks. */
export async function renderMermaid(code: string, dark: boolean): Promise<string> {
  loading ??= import("mermaid").then((module) => module.default);
  const mermaid = await loading;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: dark ? "dark" : "default",
  });
  const { svg } = await mermaid.render(`hive-mermaid-${nextId++}`, code);
  return svg;
}

import { useState } from "react";

const LABEL = "text-[10px] text-muted-foreground uppercase font-semibold";

/** Past this, a text is cut to a few lines with a toggle to read the rest. */
const LONG_TEXT_CHARS = 160;
const LONG_TEXT_LINES = 4;

/** "systemPrompt" → "System prompt", "output_key" → "Output key". */
function humanizeKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isLongText(text: string): boolean {
  return text.length > LONG_TEXT_CHARS || text.split("\n").length > LONG_TEXT_LINES;
}

function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <p
        className={`whitespace-pre-wrap wrap-break-word text-xs text-foreground ${
          expanded ? "" : "line-clamp-4"
        }`}
      >
        {text}
      </p>
      <button
        type="button"
        className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function ConfigValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <p className="text-xs italic text-muted-foreground">Not set</p>;
  }
  if (typeof value === "string") {
    return isLongText(value) ? (
      <CollapsibleText text={value} />
    ) : (
      <p className="whitespace-pre-wrap wrap-break-word text-xs text-foreground">{value}</p>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <p className="text-xs text-foreground">{String(value)}</p>;
  }
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) {
    return value.length === 0 ? (
      <p className="text-xs italic text-muted-foreground">None</p>
    ) : (
      <p className="wrap-break-word text-xs text-foreground">{value.join(", ")}</p>
    );
  }
  // Nested settings: still JSON, but in a box that cannot take over the panel.
  return (
    <pre className="mt-1 max-h-40 overflow-auto rounded border border-border/50 bg-muted/50 p-2 text-xs text-muted-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * A node's settings, one per row and readable. Long texts such as a system
 * prompt are cut short, so they do not push everything else out of view.
 */
export function ConfigView({ config }: { config: Record<string, unknown> | undefined }) {
  const entries = Object.entries(config ?? {});
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">This node has no configuration.</p>;
  }
  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key}>
          <label className={LABEL}>{humanizeKey(key)}</label>
          <ConfigValue value={value} />
        </div>
      ))}
    </div>
  );
}

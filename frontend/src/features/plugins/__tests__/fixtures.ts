import type { Plugin } from "@/features/plugins/types";

export const testPlugin: Plugin = {
  id: "echo_plugin",
  name: "echo_plugin",
  description: "Repeats back whatever text it is given.",
  active: false,
  isExternal: true,
  selectionTests: [
    { query: "echo hello", kind: "positive", shouldInvoke: true },
    { query: "what's the weather today?", kind: "negative", shouldInvoke: false },
  ],
  executionTests: [
    {
      description: "echoes the given text",
      kind: "happy",
      params: { text: "hello" },
    },
  ],
};

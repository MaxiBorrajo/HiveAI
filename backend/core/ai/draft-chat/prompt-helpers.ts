export const PLUGIN_DOMAIN_CONTEXT = `A "plugin" (internally called a "bee") is a single deterministic tool a HiveAI agent can call: it takes typed parameters, runs one well-defined action (call an API, read/write a file, run a shell command, etc.), and returns a plain text result describing what happened. It is NOT a conversational agent and does not call other tools itself.`;

export function nameCollisionRule(existingPluginNames: string[]): string {
  if (existingPluginNames.length === 0) return "";
  return `\n\nAlready-registered plugin names (choose a DIFFERENT, descriptive snake_case name, never reuse one of these): ${existingPluginNames.join(", ")}`;
}

export const homeDir: string = (Deno.env.get("HOME") ??
  Deno.env.get("USERPROFILE"))!;

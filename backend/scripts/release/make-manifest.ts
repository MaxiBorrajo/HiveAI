function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key.startsWith("--") || value === undefined) {
      throw new Error(`Invalid arguments near "${key}"`);
    }
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

async function sha256Hex(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bsdiff(oldPath: string, newPath: string, patchPath: string) {
  const { success, stderr } = await new Deno.Command("bsdiff", {
    args: [oldPath, newPath, patchPath],
  }).output();
  if (!success) {
    throw new Error(`bsdiff failed: ${new TextDecoder().decode(stderr)}`);
  }
}

const args = parseArgs(Deno.args);
for (const required of ["version", "new", "olds", "out"]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

await Deno.mkdir(args.out, { recursive: true });

const patches: Record<string, { name: string; sha256: string }> = {};
for await (const entry of Deno.readDir(args.olds)) {
  const from = entry.name.match(/^hive-ai-(\d+\.\d+\.\d+)-/)?.[1];
  if (!entry.isFile || !from || from === args.version) continue;

  const name = `patch-${from}-to-${args.version}.bin`;
  const patchPath = `${args.out}/${name}`;
  await bsdiff(`${args.olds}/${entry.name}`, args.new, patchPath);
  patches[from] = { name, sha256: await sha256Hex(patchPath) };
  console.log(`Patch ${from} -> ${args.version}: ${name}`);
}

await Deno.writeTextFile(
  `${args.out}/latest.json`,
  JSON.stringify({ version: args.version, patches }, null, 2) + "\n",
);
console.log(`latest.json: version ${args.version}, ${Object.keys(patches).length} patch(es)`);

# External plugins (user-imported)

Lets a user import a plugin from an arbitrary folder at runtime, without
rebuilding or recompiling the app.

## Why this exists

Once the backend is packaged (`deno compile` / `deno desktop`), it **cannot**
dynamically `import()` a path it didn't know about at build time — confirmed
against Deno's own docs:

- `import()` of a non-statically-analyzable path is dropped from the
  compiled binary. Same limitation applies to `new Worker()`.
- Compiled binaries can't request new permissions at runtime — permission
  flags are baked in at compile time.
- `--allow-read=/some/dir` *does* cover files added to that directory after
  compilation (permissions are path-scoped, not file-scoped) — but that only
  helps with *reading* a file, not *importing* it as a module.

So a plugin folder the user picks after install can never be `import()`-ed
directly inside the compiled main process. Every plugin folder that isn't
one of the built-in ones bundled at build time has to run somewhere else.

## How it works

1. **`plugin-runner.ts`** — a small script that is *never compiled*. It's
   always launched via `deno run` (interpreted), which has none of the
   compiled binary's restrictions: it does a normal dynamic `import()` of
   each active plugin's `index.ts`, and serves **every currently-active
   external plugin** over HTTP on a single OS-assigned localhost port,
   namespaced by name (`/plugins/:name/manifest`, `/plugins/:name/process`,
   `/plugins/:name/load`, `/plugins/:name/execution-test`, `DELETE
   /plugins/:name`). One shared process, not one process per plugin — see
   "Why a shared process, not one per plugin" below.

2. **`external-plugin-host.ts`** — runs inside the main (possibly compiled)
   process. Owns that single `plugin-runner.ts` subprocess as a lazily-
   started singleton: the first time any external plugin activates, it
   spawns the subprocess via `Deno.Command` and waits for its `{"port": N}`
   handshake on stdout; every plugin after that just asks the already-
   running subprocess to load/unload it (`POST`/`DELETE
   /plugins/:name`). Wraps each loaded plugin as an ordinary `BeePlugin`
   object via fetch calls. `HiveMicrokernel.register()` and everything
   downstream (`Executor`, `validatePlugin`, etc.) can't tell the difference
   between this and a built-in plugin — or that it's sharing a process with
   other external plugins.

3. **`external-plugin-registry.ts`** — persistence. Importing a plugin
   copies its folder into `~/.hiveai/storage/external-plugins/<name>/`
   (not just remembering the original path, which could move/disappear) and
   records it in a `manifest.json`, along with its metadata (description,
   tests) so `HiveMicrokernel.loadPersistedExternalPlugins()` can register
   it at startup **without** loading it into the shared subprocess —
   loading only happens lazily, the first time the plugin is activated (see
   `HiveMicrokernel.activate()`/`deactivate()`).

4. **`requestApproval`/`reportStep` callbacks** — `humanInteractionQueue`
   and the step-capture buffers both live only in the main process, so the
   subprocess proxies these calls back over HTTP
   (see `modules/externalPluginCallbacks/`). `AsyncLocalStorage` does
   **not** survive that HTTP round-trip (verified with a live test — an
   inbound request is a fresh async context, unrelated to whichever
   `captureSteps()` call is waiting on the outbound fetch that triggered
   it). The correlation is done explicitly instead: `step-capture.ts`
   generates a `callId` per `Executor` invocation, `external-plugin-host.ts`
   reads it via `getCurrentCallId()` while still in the original call chain
   and sends it in the `/process` request body, the subprocess echoes it
   back on every callback, and the callback handler uses
   `reportPluginStepForCall(callId, label)` to route it to the right buffer.

## Why a shared process, not one per plugin

The original design launched a separate `deno run` subprocess per active
external plugin. That gave perfect isolation (one plugin crashing or
looping couldn't affect another), but an idle Deno/V8 process has a real
memory floor — with several external plugins active at once, that adds up
fast for what's supposed to be a lightweight feature.

Switched to a single shared `plugin-runner.ts` process that loads/unloads
plugins into itself on demand:

- `HiveMicrokernel.activate(name)` calls `launchExternalPlugin(name, dir,
  callbackBaseUrl)`, which lazily starts the shared subprocess if it isn't
  already running, then asks it to load that one plugin.
- `HiveMicrokernel.deactivate(name)` unloads just that plugin
  (`DELETE /plugins/:name`), then calls `stopSharedHostIfIdle(...)` — which
  kills the whole subprocess only if no other external plugin is still
  active, so the process itself doesn't linger empty.
- Importing/removing a plugin follow the same pattern (see
  `importExternalPlugin`/`removeExternalPlugin` in `hive-microkernel.ts`).

**Tradeoff accepted**: every active external plugin now shares one process,
so a bug in one plugin's code (unhandled crash, infinite loop, runaway
memory) can take down every other active external plugin at the same time,
not just itself. Built-in plugins and the main process are unaffected
either way — they never run inside this subprocess. Revisit if this
isolation loss turns out to matter more in practice than the memory
savings.

## Third-party libraries inside a user plugin

A plugin's `index.ts` can import external libraries without any extra setup
on our side, as long as it uses a specifier Deno resolves without a project
`deno.json`:

- `npm:<package>` (e.g. `import { nanoid } from "npm:nanoid@5"`) — Deno
  resolves and caches npm packages natively, no `node_modules` involved.
  Verified working end-to-end through plugin-runner.ts as-is.
- A full URL (e.g. `import ky from "https://esm.sh/ky"`).

Bare specifiers (`import axios from "axios"`) do **not** work — that
requires an import map, which would mean generating a `deno.json` per
imported plugin and is not implemented. Since `npm:`/URL imports already
cover the same libraries with one extra keyword, there's been no reason to
build that yet.

## What's NOT done yet: bundling a Deno binary for packaged builds

Today, `external-plugin-host.ts`'s `resolveDenoExecutable()` does:

```ts
function resolveDenoExecutable(): string {
  return Deno.env.get("HIVEAI_DENO_BIN") || "deno";
}
```

This works in development because `deno` is on the developer's PATH. It will
**not** work for an end user who installs the packaged app and has never
installed Deno themselves — there is nothing to spawn `plugin-runner.ts`
with.

### The plan, when this becomes necessary

1. **At build time**, download the official Deno binary for each target
   platform (from `github.com/denoland/deno/releases` — a single executable
   per OS/arch) into something like `backend/vendor/deno-<platform>`.

2. **When compiling/packaging**, embed those binaries with
   `deno compile --include-as-is=./vendor ...` (or the equivalent
   `deno desktop` option, if it exposes one — needs checking). Confirmed via
   Deno's docs: `--include-as-is` embeds files verbatim (no module
   resolution attempted on them, unlike plain `--include`), retrievable at
   runtime via `import.meta.dirname`.

3. **At runtime**, the first time an external plugin needs to launch:
   - Detect the current platform (`Deno.build.os` / `Deno.build.arch`).
   - Read the matching embedded binary from
     `import.meta.dirname + "/vendor/deno-<platform>"`.
   - **Write it to a real file** on disk (e.g. `~/.hiveai/bin/deno[.exe]`) —
     confirmed a compiled binary's embedded resources can't be executed
     in-place via `Deno.Command`; they have to be extracted to an actual
     filesystem path first. Only do this once (skip if the file already
     exists there).
   - On Unix, `Deno.chmod(path, 0o755)` — the executable bit isn't
     guaranteed to survive embedding/extraction.
   - Set `HIVEAI_DENO_BIN` (or just change `resolveDenoExecutable()`'s
     fallback logic) to point at that extracted path.

4. No other code needs to change — `resolveDenoExecutable()` is already the
   single seam this plugs into.

### Why this wasn't done now

There's no packaging/build pipeline wired up yet in this repo, and no vendor
binaries downloaded — building this now would be speculative. Revisit once
the actual `deno compile`/`deno desktop` packaging step is being set up for
real, since that's when platform targets, output paths, and the
`--include-as-is` invocation actually need to be decided together.

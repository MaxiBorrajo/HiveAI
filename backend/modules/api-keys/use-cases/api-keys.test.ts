import { assert, assertEquals, assertRejects } from "@std/assert";
import { SecretStore } from "../../../core/secrets/secret-store.ts";
import { ProviderError } from "../../../core/ai/providers/errors.ts";
import type { ApiKeyRepository } from "../../../infrastructure/db/repositories/api-key-repository.ts";
import type { ApiKeyRow } from "../../../infrastructure/db/schema/index.ts";
import type { ApiKeyDeps, ApiKeyUsage } from "../types.ts";
import { createApiKey } from "./create-api-key.ts";
import { ApiKeyInUseError, deleteApiKey } from "./delete-api-key.ts";
import { listApiKeys } from "./list-api-keys.ts";
import { updateApiKey } from "./update-api-key.ts";

class FakeRepo {
  rows = new Map<string, ApiKeyRow>();
  findAll() {
    return Promise.resolve([...this.rows.values()]);
  }
  findById(id: string) {
    return Promise.resolve(this.rows.get(id));
  }
  create(row: ApiKeyRow) {
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }
  update(id: string, data: Partial<ApiKeyRow>) {
    this.rows.set(id, { ...this.rows.get(id)!, ...data });
    return Promise.resolve();
  }
  delete(id: string) {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

async function setup(usage: ApiKeyUsage = { chat: false, executions: [] }) {
  const dir = await Deno.makeTempDir();
  const secrets = new SecretStore(dir);
  const repo = new FakeRepo();
  const validated: string[] = [];
  const deps: ApiKeyDeps = {
    repo: repo as unknown as ApiKeyRepository,
    secrets,
    findUsage: () => Promise.resolve(usage),
    validate: (_provider, value) => {
      validated.push(value);
      if (value.startsWith("bad")) {
        throw new ProviderError("invalid_key", "The provider rejected this API key.");
      }
      return Promise.resolve();
    },
  };
  return { deps, secrets, repo, validated, dir };
}

Deno.test("api keys - two keys of the same provider, masked listing", async () => {
  const { deps, secrets, dir } = await setup();
  const a = await createApiKey(deps, { provider: "anthropic", alias: "Claude – personal", value: "sk-ant-aaaa1111" });
  const b = await createApiKey(deps, { provider: "anthropic", alias: "Claude – work", value: "sk-ant-bbbb2222" });
  assertEquals(a.masked, "••••1111");
  assertEquals(await secrets.get(a.id), "sk-ant-aaaa1111");
  assertEquals(await secrets.get(b.id), "sk-ant-bbbb2222");
  const list = await listApiKeys(deps);
  assertEquals(list.length, 2);
  assert(!JSON.stringify(list).includes("sk-ant"));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("api keys - invalid key is rejected and not stored", async () => {
  const { deps, repo, dir } = await setup();
  await assertRejects(
    () => createApiKey(deps, { provider: "google", alias: "x", value: "bad-key" }),
    Error,
    "rejected",
  );
  assertEquals(repo.rows.size, 0);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("api keys - duplicate alias within provider is rejected", async () => {
  const { deps, dir } = await setup();
  await createApiKey(deps, { provider: "google", alias: "Main", value: "sk-1" });
  await assertRejects(() =>
    createApiKey(deps, { provider: "google", alias: "main", value: "sk-2" }),
  );
  await createApiKey(deps, { provider: "anthropic", alias: "Main", value: "a-1" });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("api keys - rename and replace value (re-validates)", async () => {
  const { deps, secrets, validated, dir } = await setup();
  const k = await createApiKey(deps, { provider: "google", alias: "A", value: "sk-0000" });
  const updated = await updateApiKey(deps, k.id, { alias: "B", value: "sk-9999" });
  assertEquals(updated.alias, "B");
  assertEquals(updated.masked, "••••9999");
  assertEquals(await secrets.get(k.id), "sk-9999");
  assertEquals(validated, ["sk-0000", "sk-9999"]);
  await assertRejects(() => updateApiKey(deps, k.id, { value: "bad-new" }));
  assertEquals(await secrets.get(k.id), "sk-9999");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("api keys - deleting a key in use requires force", async () => {
  const { deps, secrets, repo, dir } = await setup({
    chat: false,
    executions: [{ id: 1, name: "Flow", nodeIds: ["n1"] }],
  });
  const k = await createApiKey(deps, { provider: "anthropic", alias: "A", value: "sk-zzzz" });
  await assertRejects(() => deleteApiKey(deps, k.id), ApiKeyInUseError);
  assertEquals(repo.rows.size, 1);
  await deleteApiKey(deps, k.id, true);
  assertEquals(repo.rows.size, 0);
  assertEquals(await secrets.get(k.id), undefined);
  await Deno.remove(dir, { recursive: true });
});

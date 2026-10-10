import { assert, assertEquals, assertRejects } from "@std/assert";
import { SecretStore } from "../../core/secrets/secret-store.ts";
import { ProviderError } from "../../core/ai/providers/errors.ts";
import type { ApiKeyRepository } from "../../infrastructure/db/repositories/api-key-repository.ts";
import type { ApiKeyRow } from "../../infrastructure/db/schema/index.ts";
import {
  ApiKeyInUseError,
  ApiKeyService,
  type ApiKeyUsage,
} from "./api-key-service.ts";

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
  const service = new ApiKeyService(
    repo as unknown as ApiKeyRepository,
    secrets,
    () => Promise.resolve(usage),
    (_provider, value) => {
      validated.push(value);
      if (value.startsWith("bad")) {
        throw new ProviderError("invalid_key", "The provider rejected this API key.");
      }
      return Promise.resolve();
    },
  );
  return { service, secrets, repo, validated, dir };
}

Deno.test("ApiKeyService - two keys of the same provider, masked listing", async () => {
  const { service, secrets, dir } = await setup();
  const a = await service.create({ provider: "anthropic", alias: "Claude – personal", value: "sk-ant-aaaa1111" });
  const b = await service.create({ provider: "anthropic", alias: "Claude – work", value: "sk-ant-bbbb2222" });
  assertEquals(a.masked, "••••1111");
  assertEquals(await secrets.get(a.id), "sk-ant-aaaa1111");
  assertEquals(await secrets.get(b.id), "sk-ant-bbbb2222");
  const list = await service.list();
  assertEquals(list.length, 2);
  assert(!JSON.stringify(list).includes("sk-ant"));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ApiKeyService - invalid key is rejected and not stored", async () => {
  const { service, repo, dir } = await setup();
  await assertRejects(
    () => service.create({ provider: "anthropic", alias: "x", value: "bad-key" }),
    Error,
    "rejected",
  );
  assertEquals(repo.rows.size, 0);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ApiKeyService - duplicate alias within provider is rejected", async () => {
  const { service, dir } = await setup();
  await service.create({ provider: "anthropic", alias: "Main", value: "sk-1" });
  await assertRejects(() =>
    service.create({ provider: "anthropic", alias: "main", value: "sk-2" }),
  );
  await service.create({ provider: "google", alias: "Main", value: "g-1" });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ApiKeyService - rename and replace value (re-validates)", async () => {
  const { service, secrets, validated, dir } = await setup();
  const k = await service.create({ provider: "anthropic", alias: "A", value: "sk-0000" });
  const updated = await service.update(k.id, { alias: "B", value: "sk-9999" });
  assertEquals(updated.alias, "B");
  assertEquals(updated.masked, "••••9999");
  assertEquals(await secrets.get(k.id), "sk-9999");
  assertEquals(validated, ["sk-0000", "sk-9999"]);
  await assertRejects(() => service.update(k.id, { value: "bad-new" }));
  assertEquals(await secrets.get(k.id), "sk-9999");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ApiKeyService - deleting a key in use requires force", async () => {
  const { service, secrets, repo, dir } = await setup({
    chat: false,
    executions: [{ id: 1, name: "Flow", nodeIds: ["n1"] }],
  });
  const k = await service.create({ provider: "anthropic", alias: "A", value: "sk-zzzz" });
  await assertRejects(() => service.remove(k.id), ApiKeyInUseError);
  assertEquals(repo.rows.size, 1);
  await service.remove(k.id, true);
  assertEquals(repo.rows.size, 0);
  assertEquals(await secrets.get(k.id), undefined);
  await Deno.remove(dir, { recursive: true });
});

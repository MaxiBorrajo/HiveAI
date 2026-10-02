import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { JsonDraftPluginRepository } from "./draft-plugin-repository.ts";
import { getDraftsDir, getDraftRepository } from "./draft-context.ts";

Deno.test("getDraftsDir - joins the hive's configured dataDir with 'drafts'", () => {
  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: "/some/data/dir" });
  assertEquals(getDraftsDir(hive), join("/some/data/dir", "drafts"));
});

Deno.test("getDraftsDir - reflects dataDir changes made via configure()", () => {
  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: "/another/dir" });
  assertEquals(getDraftsDir(hive), join("/another/dir", "drafts"));
});

Deno.test("getDraftRepository - returns a JsonDraftPluginRepository rooted at <dataDir>/drafts", () => {
  const hive = HiveMicrokernel.getInstance();
  hive.configure({ dataDir: "/repo/root" });
  const repo = getDraftRepository(hive);
  assertEquals(repo instanceof JsonDraftPluginRepository, true);
});

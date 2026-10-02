import { assertEquals } from "@std/assert";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { fetchCurrentModels } from "../../modules/models/use-cases/get-current-models.ts";

Deno.test("fetchCurrentModels reflects whatever model is configured on the hive", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const hive = new HiveMicrokernel();
    hive.configure({ dataDir: tempDir, model: "qwen3:8b" });

    assertEquals(fetchCurrentModels(hive), { model: "qwen3:8b" });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("fetchCurrentModels reflects a model change via configure()", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const hive = new HiveMicrokernel();
    hive.configure({ dataDir: tempDir, model: "qwen3:8b" });
    hive.configure({ model: "lfm2.5" });

    assertEquals(fetchCurrentModels(hive), { model: "lfm2.5" });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

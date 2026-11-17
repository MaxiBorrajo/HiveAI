import { assertEquals } from "@std/assert";
import {
  OFF_BY_DEFAULT_PLUGINS,
  shouldActivateByDefault,
} from "../../../bootstrap/load-plugins.ts";

Deno.test("default activation - counter, current_datetime and generate_image start off on a fresh install", () => {
  assertEquals([...OFF_BY_DEFAULT_PLUGINS].sort(), [
    "counter",
    "current_datetime",
    "generate_image",
  ]);
  assertEquals(shouldActivateByDefault("counter", undefined), false);
  assertEquals(shouldActivateByDefault("current_datetime", undefined), false);
  // Until a provider is set up it could only fail.
  assertEquals(shouldActivateByDefault("generate_image", undefined), false);
});

Deno.test("default activation - other plugins start on", () => {
  assertEquals(shouldActivateByDefault("web_read", undefined), true);
});

Deno.test("default activation - a saved user choice always wins", () => {
  assertEquals(shouldActivateByDefault("counter", true), true);
  assertEquals(shouldActivateByDefault("web_read", false), false);
});

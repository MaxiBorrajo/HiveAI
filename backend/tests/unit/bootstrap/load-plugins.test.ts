import { assertEquals } from "@std/assert";
import {
  OFF_BY_DEFAULT_PLUGINS,
  shouldActivateByDefault,
} from "../../../bootstrap/load-plugins.ts";

Deno.test("default activation - counter and current_datetime start off on a fresh install", () => {
  assertEquals([...OFF_BY_DEFAULT_PLUGINS].sort(), ["counter", "current_datetime"]);
  assertEquals(shouldActivateByDefault("counter", undefined), false);
  assertEquals(shouldActivateByDefault("current_datetime", undefined), false);
});

Deno.test("default activation - other plugins start on", () => {
  assertEquals(shouldActivateByDefault("web_read", undefined), true);
});

Deno.test("default activation - a saved user choice always wins", () => {
  assertEquals(shouldActivateByDefault("counter", true), true);
  assertEquals(shouldActivateByDefault("web_read", false), false);
});

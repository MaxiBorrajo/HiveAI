import { assertEquals } from "@std/assert";
import { isNewerVersion } from "./version.ts";

Deno.test("isNewerVersion - a higher patch version is newer", () => {
  assertEquals(isNewerVersion("1.0.0", "1.0.1"), true);
});

Deno.test("isNewerVersion - a higher minor version is newer even with a lower patch", () => {
  assertEquals(isNewerVersion("1.0.9", "1.1.0"), true);
});

Deno.test("isNewerVersion - a higher major version is newer even with lower minor/patch", () => {
  assertEquals(isNewerVersion("2.9.9", "3.0.0"), true);
});

Deno.test("isNewerVersion - an identical version is not newer", () => {
  assertEquals(isNewerVersion("1.2.3", "1.2.3"), false);
});

Deno.test("isNewerVersion - a lower version is not newer", () => {
  assertEquals(isNewerVersion("1.2.3", "1.2.2"), false);
  assertEquals(isNewerVersion("1.2.0", "1.1.9"), false);
  assertEquals(isNewerVersion("2.0.0", "1.9.9"), false);
});

Deno.test("isNewerVersion - a leading 'v' prefix on either side is stripped before comparing", () => {
  assertEquals(isNewerVersion("v1.0.0", "v1.0.1"), true);
  assertEquals(isNewerVersion("v1.0.0", "1.0.0"), false);
  assertEquals(isNewerVersion("1.0.0", "v1.0.0"), false);
});

Deno.test("isNewerVersion - differing segment counts are compared as if missing segments were 0", () => {
  assertEquals(isNewerVersion("1.0", "1.0.1"), true);
  assertEquals(isNewerVersion("1.0.0", "1.0"), false);
  assertEquals(isNewerVersion("1", "1.0.0.1"), true);
});

Deno.test("isNewerVersion - non-numeric segments are treated as 0", () => {
  assertEquals(isNewerVersion("1.x.0", "1.0.0"), false);
  // Both "x" segments parse to 0, so this reduces to comparing [1,0,0] vs [1,0,1]
  assertEquals(isNewerVersion("1.0.0", "1.x.1"), true);
});

Deno.test("isNewerVersion - comparing two malformed/empty-ish versions does not throw and returns false", () => {
  assertEquals(isNewerVersion("", ""), false);
  assertEquals(isNewerVersion("abc", "def"), false);
});

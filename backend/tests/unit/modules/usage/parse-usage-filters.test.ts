import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_USAGE_LIMIT,
  MAX_USAGE_LIMIT,
  parseUsageFilters,
} from "../../../../modules/usage/parse-usage-filters.ts";
import { AppError } from "../../../../core/api/errors.ts";

Deno.test("parseUsageFilters - defaults and parsed values", () => {
  const empty = parseUsageFilters({});
  assertEquals(empty.limit, DEFAULT_USAGE_LIMIT);
  assertEquals(empty.offset, 0);
  assertEquals(empty.context, undefined);

  const f = parseUsageFilters({
    context: "execution",
    executionId: "7",
    location: "cloud",
    keyId: "k1",
    from: "100",
    limit: "20",
  });
  assertEquals(f.context, "execution");
  assertEquals(f.executionId, 7);
  assertEquals(f.location, "cloud");
  assertEquals(f.keyId, "k1");
  assertEquals(f.from, 100);
  assertEquals(f.limit, 20);
});

Deno.test("parseUsageFilters - rejects bad values with a 400", () => {
  const bad: Record<string, string>[] = [
    { context: "nope" },
    { chatId: "abc" },
    { limit: "0" },
    { limit: String(MAX_USAGE_LIMIT + 1) },
    { offset: "-1" },
  ];
  for (const query of bad) {
    const error = assertThrows(() => parseUsageFilters(query), AppError);
    assertEquals(error.status, 400);
  }
});

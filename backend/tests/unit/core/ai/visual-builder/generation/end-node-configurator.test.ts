import { assertEquals } from "@std/assert";
import { buildEndNodeConfigSchema } from "../../../../../../core/ai/visual-builder/generation/end-node-configurator.ts";

function validBase() {
  return {
    thought: "This workflow produces a markdown report.",
    type: "markdown",
    summary: "A report",
    contentKey: "report_output",
    requiresUserInput: false,
  };
}

Deno.test("buildEndNodeConfigSchema - accepts a well-formed deliverable spec", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  const result = schema.safeParse(validBase());
  assertEquals(result.success, true);
});

Deno.test("buildEndNodeConfigSchema - with known state keys, contentKey is restricted to that enum", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  const bad = schema.safeParse({ ...validBase(), contentKey: "not_a_real_key" });
  assertEquals(bad.success, false);
});

Deno.test("buildEndNodeConfigSchema - with no state keys (default []), contentKey falls back to an unrestricted string", () => {
  const schema = buildEndNodeConfigSchema();
  const result = schema.safeParse({ ...validBase(), contentKey: "anything" });
  assertEquals(result.success, true);
});

Deno.test("buildEndNodeConfigSchema - type must be one of the fixed deliverable type enum", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  const bad = schema.safeParse({ ...validBase(), type: "not_a_real_type" });
  assertEquals(bad.success, false);

  for (const type of ["file", "markdown", "table", "chart", "json", "image", "html", "url", "terminal", "boolean", "text"]) {
    const result = schema.safeParse({ ...validBase(), type });
    assertEquals(result.success, true, `expected type "${type}" to be valid`);
  }
});

Deno.test("buildEndNodeConfigSchema - files is optional and, when provided, each entry needs name and path", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  const withoutFiles = schema.safeParse(validBase());
  assertEquals(withoutFiles.success, true);

  const withValidFiles = schema.safeParse({
    ...validBase(),
    type: "file",
    files: [{ name: "report.md", path: "report.md" }],
  });
  assertEquals(withValidFiles.success, true);

  const withInvalidFiles = schema.safeParse({
    ...validBase(),
    type: "file",
    files: [{ name: "report.md" }], // missing required "path"
  });
  assertEquals(withInvalidFiles.success, false);
});

Deno.test("buildEndNodeConfigSchema - inputDescription is optional and only meaningful alongside requiresUserInput", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  const withoutDescription = schema.safeParse(validBase());
  assertEquals(withoutDescription.success, true);

  const withDescription = schema.safeParse({
    ...validBase(),
    requiresUserInput: true,
    inputDescription: "The support ticket to classify",
  });
  assertEquals(withDescription.success, true);
});

Deno.test("buildEndNodeConfigSchema - requiresUserInput is a required boolean field", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  const { requiresUserInput: _omit, ...withoutIt } = validBase();
  assertEquals(schema.safeParse(withoutIt).success, false);
  assertEquals(schema.safeParse({ ...validBase(), requiresUserInput: "yes" }).success, false);
});

Deno.test("buildEndNodeConfigSchema - missing required top-level fields (thought/type/summary/contentKey) fails validation", () => {
  const schema = buildEndNodeConfigSchema(["report_output"]);
  assertEquals(schema.safeParse({ type: "markdown" }).success, false);
  assertEquals(schema.safeParse({}).success, false);
});

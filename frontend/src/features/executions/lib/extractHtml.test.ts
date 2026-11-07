import { describe, expect, it } from "vitest";
import { extractHtmlDocument } from "../components/result/ResultRenderer";
import type { ExecutionResult } from "../types";

const result = (content: string): ExecutionResult => ({
  type: "file",
  summary: "",
  content,
});

describe("extractHtmlDocument", () => {
  it("finds a whole-content document", () => {
    expect(extractHtmlDocument(result("<!DOCTYPE html><html></html>"))).toContain("<html>");
  });

  it("finds a fenced document surrounded by prose", () => {
    const html = extractHtmlDocument(
      result("Archivo guardado en `/x/index.html`.\n\n```html\n<!DOCTYPE html>\n<html><body>hi</body></html>\n```\nListo."),
    );
    expect(html).toBe("<!DOCTYPE html>\n<html><body>hi</body></html>");
  });

  it("still finds the document when the fence was never closed", () => {
    expect(extractHtmlDocument(result("Saved.\n```html\n<!DOCTYPE html>\n<html>"))).toContain("<html>");
  });

  it("ignores code fences that are not HTML documents", () => {
    expect(extractHtmlDocument(result("```js\nconst a = 1;\n```"))).toBeNull();
  });
});

import { assertEquals } from "@std/assert";
import { unwrapCodeFence } from "../../../../plugins/file-ops/unwrap-code-fence.ts";

const html = "<!DOCTYPE html>\n<html></html>";

Deno.test("unwrapCodeFence - removes a fence wrapping the whole file", () => {
  assertEquals(unwrapCodeFence("/a/index.html", "```html\n" + html + "\n```"), html);
  assertEquals(unwrapCodeFence("/a/index.html", "```\n" + html + "\n```\n"), html);
});

Deno.test("unwrapCodeFence - leaves plain content untouched", () => {
  assertEquals(unwrapCodeFence("/a/index.html", html), html);
});

Deno.test("unwrapCodeFence - keeps fences in markdown and text files", () => {
  const md = "```js\nlet a = 1\n```";
  assertEquals(unwrapCodeFence("/a/README.md", md), md);
  assertEquals(unwrapCodeFence("/a/notes.txt", md), md);
});

Deno.test("unwrapCodeFence - ignores content with prose around the fence or several blocks", () => {
  const prose = "Here it is:\n```html\n" + html + "\n```";
  const two = "```js\na\n```\n\n```js\nb\n```";
  assertEquals(unwrapCodeFence("/a/index.html", prose), prose);
  assertEquals(unwrapCodeFence("/a/index.html", two), two);
});

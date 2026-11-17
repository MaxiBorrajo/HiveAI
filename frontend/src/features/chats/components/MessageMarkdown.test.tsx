import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/renderMermaid", () => ({
  renderMermaid: vi.fn(async (code: string) => `<svg data-testid="diagram"><text>${code.length}</text></svg>`),
}));

import { MessageMarkdown } from "./MessageMarkdown";
import { mediaKind, normalizeMathDelimiters, openFenceOffset } from "../lib/markdown";

const fence = "```";

describe("markdown helpers", () => {
  test("mediaKind goes by the file extension, ignoring the query", () => {
    expect(mediaKind("https://x.test/clip.MP4?t=3")).toBe("video");
    expect(mediaKind("/files/voice.ogg")).toBe("audio");
    expect(mediaKind("https://x.test/photo.png")).toBeNull();
    expect(mediaKind(undefined)).toBeNull();
  });

  test("\\( \\) and \\[ \\] become $$, but not inside code", () => {
    expect(normalizeMathDelimiters("area \\(\\pi r^2\\) here")).toBe("area $$\\pi r^2$$ here");
    expect(normalizeMathDelimiters("\\[x = 1\\]")).toBe("\n$$\nx = 1\n$$\n");
    const code = `${fence}latex\n\\(keep\\)\n${fence}`;
    expect(normalizeMathDelimiters(code)).toBe(code);
    expect(normalizeMathDelimiters("costs $5 and $10")).toBe("costs $5 and $10");
  });

  test("openFenceOffset finds a block still being written", () => {
    expect(openFenceOffset(`a\n${fence}js\nx\n${fence}\nb`)).toBeNull();
    expect(openFenceOffset(`intro\n${fence}mermaid\ngraph TD`)).toBe(6);
  });
});

describe("MessageMarkdown", () => {
  test("a fenced block shows its language and copies its code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MessageMarkdown content={`${fence}ts\nconst a = 1;\n${fence}`} />);

    expect(screen.getByText("ts")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
  });

  test("an svg block is drawn as an image, with the code one click away", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
    render(<MessageMarkdown content={`${fence}svg\n${svg}\n${fence}`} />);

    const image = screen.getByRole("img", { name: "SVG drawing" });
    expect(image.getAttribute("src")).toContain("data:image/svg+xml");
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.queryByRole("img", { name: "SVG drawing" })).not.toBeInTheDocument();
    expect(screen.getByText(/circle/)).toBeInTheDocument();
  });

  test("a drawing labeled xml is still drawn, but other xml stays code", () => {
    const drawing = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
    const { unmount } = render(<MessageMarkdown content={`${fence}xml\n${drawing}\n${fence}`} />);
    expect(screen.getByRole("img", { name: "SVG drawing" })).toBeInTheDocument();
    unmount();

    render(<MessageMarkdown content={`${fence}xml\n<note>hi</note>\n${fence}`} />);
    expect(screen.queryByRole("img", { name: "SVG drawing" })).not.toBeInTheDocument();
  });

  test("a mermaid block becomes a diagram once its fence is closed", async () => {
    const { rerender } = render(<MessageMarkdown content={`${fence}mermaid\ngraph TD; A-->B`} />);
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();

    rerender(<MessageMarkdown content={`${fence}mermaid\ngraph TD; A-->B\n${fence}`} />);
    await waitFor(() => expect(screen.getByTestId("diagram")).toBeInTheDocument());
  });

  test("$$ math is typeset, a single $ stays text", () => {
    const { container } = render(<MessageMarkdown content={"Energy $$E=mc^2$$ costs $5 and $10"} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).toContain("costs $5 and $10");
  });

  test("images fit the message; video and audio links get a player", () => {
    const { container } = render(
      <MessageMarkdown
        content={"![a cat](https://x.test/cat.png)\n\n![demo](https://x.test/demo.mp4)\n\n[voice note](https://x.test/note.mp3)"}
      />,
    );
    expect(screen.getByRole("img", { name: "a cat" })).toHaveClass("max-w-full");
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x.test/demo.mp4");
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("https://x.test/note.mp3");
    expect(screen.getByRole("link", { name: "voice note" })).toBeInTheDocument();
  });
});

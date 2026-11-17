import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentsList } from "../components/AttachmentsList";
import { parseCsv } from "../components/AttachmentPreview";
import { getAttachmentText, type AttachmentDto } from "../api/attachments";

vi.mock("../api/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/attachments")>()),
  getAttachmentText: vi.fn(),
}));

function file(originalName: string, mimeType: string, extra: Partial<AttachmentDto> = {}): AttachmentDto {
  return {
    id: 7,
    originalName,
    mimeType,
    sizeBytes: 10,
    direction: "output",
    status: "ready",
    createdAt: 1,
    ...extra,
  };
}

function preview(attachment: AttachmentDto, text = "") {
  vi.mocked(getAttachmentText).mockResolvedValue({ success: true, data: { text } } as never);
  render(<AttachmentsList attachments={[attachment]} />);
  fireEvent.click(screen.getByTitle("Preview"));
}

describe("generated file preview", () => {
  beforeEach(() => vi.mocked(getAttachmentText).mockReset());

  it("shows a CSV as a table", async () => {
    preview(file("sales.csv", "text/csv"), 'month,total\njan,"1,000"\n');

    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByRole("columnheader", { name: "month" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "1,000" })).toBeTruthy();
  });

  it("renders Markdown, and the text of a Word document the same way", async () => {
    preview(file("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "# Quarterly report");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Quarterly report" })).toBeTruthy());
  });

  it("indents JSON, with colors", async () => {
    preview(file("data.json", "application/json"), '{"a":1}');

    await waitFor(() => expect(document.querySelector("code.language-json")?.textContent).toContain('"a": 1'));
  });

  it("shows a code file with the colors of its language", async () => {
    preview(file("script.py", "text/x-python"), "def hi():\n    return 1");

    await waitFor(() => expect(document.querySelector("code.language-python")).not.toBeNull());
    expect(document.querySelector(".hljs-keyword")?.textContent).toBe("def");
  });

  it("opens a PDF in its viewer, with its text one tab away", async () => {
    preview(file("report.pdf", "application/pdf"), "Page one text");

    const frame = screen.getByTitle("report.pdf document");
    expect(frame.getAttribute("src")).toMatch(/\/api\/attachments\/7\/download\?inline=1$/);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("Page one text")).toBeTruthy());
  });

  it("draws a web page in an isolated frame, with its code one tab away", async () => {
    preview(file("page.html", "text/html"), "<h1>Hello</h1>");

    const frame = await screen.findByTitle("page.html preview");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    await waitFor(() => expect(document.querySelector("code.language-html")).not.toBeNull());
  });

  it("moves between files with the arrows", async () => {
    vi.mocked(getAttachmentText).mockResolvedValue({ success: true, data: { text: "x" } } as never);
    render(
      <AttachmentsList
        attachments={[file("a.md", "text/markdown", { id: 1 }), file("b.md", "text/markdown", { id: 2 })]}
      />,
    );
    fireEvent.click(screen.getAllByTitle("Preview")[0]);
    expect(await screen.findByText("1 of 2", { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByTitle("Next file"));
    expect(await screen.findByText("2 of 2", { exact: false })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "b.md" })).toBeTruthy();
  });

  it("a generated text file shows its first lines on the card", async () => {
    vi.mocked(getAttachmentText).mockResolvedValue({ success: true, data: { text: "# Plan\nstep one" } } as never);
    render(<AttachmentsList attachments={[file("plan.md", "text/markdown")]} />);

    await waitFor(() => expect(screen.getByText(/step one/)).toBeTruthy());
  });

  it("shows an image without asking for its text", async () => {
    preview(file("chart.png", "image/png"));

    expect(screen.getByRole("img", { name: "chart.png" })).toBeTruthy();
    expect(getAttachmentText).not.toHaveBeenCalled();
  });

  it("explains when the preview cannot be loaded", async () => {
    vi.mocked(getAttachmentText).mockResolvedValue({ success: false, errors: ["This file has no text to preview."] } as never);
    render(<AttachmentsList attachments={[file("notes.md", "text/markdown")]} />);
    fireEvent.click(screen.getByTitle("Preview"));

    await waitFor(() => expect(screen.getByText("This file has no text to preview.")).toBeTruthy());
  });

  it("offers no preview while a file is being attached", () => {
    render(<AttachmentsList attachments={[file("notes.md", "text/markdown")]} onRemove={() => {}} />);

    expect(screen.queryByTitle("Preview")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes and line breaks inside fields", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });
});

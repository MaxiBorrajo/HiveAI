import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("indents JSON", async () => {
    preview(file("data.json", "application/json"), '{"a":1}');

    await waitFor(() => expect(screen.getByText(/"a": 1/)).toBeTruthy());
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

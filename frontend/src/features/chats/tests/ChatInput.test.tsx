import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../components/ChatInput";
import { uploadChatAttachment, type AttachmentDto } from "../api/attachments";
import { reportError } from "@/lib/toastManager";

vi.mock("../api/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/attachments")>()),
  uploadChatAttachment: vi.fn(),
}));
vi.mock("@/features/models/ModelsContext", () => ({
  useModels: () => ({
    hasModel: true,
    current: { provider: "ollama" },
    hasAvailableModels: true,
    embeddingModelStatus: null,
    openManage: vi.fn(),
    openExplore: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));
vi.mock("../../models/components/ModelsManager.tsx", () => ({
  ModelsManager: () => null,
}));
vi.mock("@/lib/toastManager", () => ({ reportError: vi.fn() }));

function dto(id: number, originalName: string): AttachmentDto {
  return {
    id,
    originalName,
    mimeType: "text/plain",
    sizeBytes: 1,
    direction: "input",
    status: "ready",
    createdAt: 1,
  };
}

function Harness() {
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  return (
    <ChatInput
      input=""
      setInput={() => {}}
      isThinking={false}
      handleSend={() => {}}
      handleStop={() => {}}
      hidePluginsAndModes
      attachments={attachments}
      onAttachmentsChange={setAttachments}
    />
  );
}

describe("ChatInput attachments", () => {
  beforeEach(() => {
    vi.mocked(uploadChatAttachment).mockReset();
    vi.mocked(reportError).mockReset();
  });

  it("keeps every file when several are selected at once", async () => {
    vi.mocked(uploadChatAttachment)
      .mockResolvedValueOnce({ data: dto(1, "a.txt") } as never)
      .mockResolvedValueOnce({ data: dto(2, "b.txt") } as never);
    const { container } = render(<Harness />);

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [
          new File(["a"], "a.txt", { type: "text/plain" }),
          new File(["b"], "b.txt", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => expect(screen.getByText("b.txt")).toBeTruthy());
    expect(screen.getByText("a.txt")).toBeTruthy();
  });

  it("does not upload a file of an unsupported type, and says what is supported", async () => {
    const { container } = render(<Harness />);

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["x"], "virus.exe")] },
    });

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith([
        expect.stringMatching(/virus\.exe.*\.docx/),
      ]),
    );
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });

  it("does not upload a file over the size limit", async () => {
    const { container } = render(<Harness />);
    const huge = new File(["x"], "huge.pdf");
    Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [huge] },
    });

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith([
        expect.stringContaining("exceeds the 10MB limit"),
      ]),
    );
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });
});

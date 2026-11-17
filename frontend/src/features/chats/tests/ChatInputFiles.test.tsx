import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../components/ChatInput";
import { uploadChatAttachment } from "../api/attachments";

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
vi.mock("@/features/models/components/ModelsManager.tsx", () => ({
  ModelsManager: () => null,
}));
vi.mock("@/lib/toastManager", () => ({ reportError: vi.fn() }));

function renderInput(onAttachmentsChange = vi.fn()) {
  render(
    <ChatInput
      input=""
      setInput={() => {}}
      isThinking={false}
      handleSend={() => {}}
      handleStop={() => {}}
      hidePluginsAndModes
      attachments={[]}
      onAttachmentsChange={onAttachmentsChange}
    />,
  );
  return onAttachmentsChange;
}

const screenshot = () => new File(["png"], "image.png", { type: "image/png" });

describe("attaching files without the paperclip", () => {
  beforeEach(() => {
    vi.mocked(uploadChatAttachment).mockReset().mockResolvedValue({
      success: true,
      data: { id: 1, originalName: "image.png", mimeType: "image/png", sizeBytes: 3, direction: "input", status: "ready", createdAt: 1 },
    } as never);
  });

  it("a pasted screenshot is attached", async () => {
    const onAttachmentsChange = renderInput();
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [screenshot()] } });

    await waitFor(() => expect(uploadChatAttachment).toHaveBeenCalledTimes(1));
    expect(onAttachmentsChange).toHaveBeenCalledWith([expect.objectContaining({ originalName: "image.png" })]);
  });

  it("pasted text is left to the text box", () => {
    renderInput();
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [] } });
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });

  it("files dropped on the box are attached", async () => {
    renderInput();
    const box = screen.getByRole("textbox").parentElement!;
    const dataTransfer = { types: ["Files"], files: [screenshot()] };

    fireEvent.dragOver(box, { dataTransfer });
    expect(screen.getByText("Drop files to attach them")).toBeTruthy();
    fireEvent.drop(box, { dataTransfer });

    await waitFor(() => expect(uploadChatAttachment).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Drop files to attach them")).toBeNull();
  });
});

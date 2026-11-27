import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "@/features/chats/components/ChatInput";
import { uploadChatAttachment } from "@/features/chats/api/attachments";
import { reportError } from "@/lib/toastManager";
import { transcribeAudio } from "../lib/transcriber";
import { toMono } from "../lib/decodeAudio";
import { isAudioFile } from "../lib/audioFiles";
import { defaultSpeechLanguage, nextSpeechLanguage } from "../lib/language";

vi.mock("../lib/transcriber", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/features/chats/api/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chats/api/attachments")>()),
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

/** A stand-in for the browser recorder: stop() hands over one chunk of audio. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeMediaRecorder.instances.push(this);
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn();

function Harness({ initial = "" }: { initial?: string }) {
  const [input, setInput] = useState(initial);
  return (
    <>
      <ChatInput
        input={input}
        setInput={setInput}
        isThinking={false}
        handleSend={() => {}}
        handleStop={() => {}}
        hidePluginsAndModes
        attachments={[]}
        onAttachmentsChange={() => {}}
      />
      <output data-testid="input">{input}</output>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  FakeMediaRecorder.instances = [];
  stopTrack.mockReset();
  getUserMedia.mockReset().mockResolvedValue({
    getTracks: () => [{ stop: stopTrack }],
  });
  vi.mocked(transcribeAudio).mockReset();
  vi.mocked(reportError).mockReset();
  vi.mocked(uploadChatAttachment).mockReset();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voice input", () => {
  it("records, then puts the transcription in the input to review before sending", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue("hola, ¿qué tiempo hace?");
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and transcribe" }));

    await waitFor(() =>
      expect(screen.getByTestId("input")).toHaveTextContent("hola, ¿qué tiempo hace?"),
    );
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    const [audio] = vi.mocked(transcribeAudio).mock.calls[0];
    expect((audio as Blob).type).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalled();
    // Back to the mic button, ready for the next one.
    expect(screen.getByRole("button", { name: "Record a voice message" })).toBeInTheDocument();
  });

  it("adds the transcription after what was already typed", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue("en Buenos Aires");
    render(<Harness initial="Qué tiempo hace " />);

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and transcribe" }));

    await waitFor(() =>
      expect(screen.getByTestId("input")).toHaveTextContent("Qué tiempo hace en Buenos Aires"),
    );
  });

  it("transcribes in the language picked next to the mic, and remembers it", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue("hola");
    const { unmount } = render(<Harness />);
    // jsdom reports an English system, so English comes first.
    fireEvent.click(
      screen.getByRole("button", { name: "Transcription language: English. Switch to Español" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and transcribe" }));

    await waitFor(() => expect(transcribeAudio).toHaveBeenCalled());
    expect(vi.mocked(transcribeAudio).mock.calls[0][1]).toBe("es");

    unmount();
    render(<Harness />);
    expect(await screen.findByRole("button", { name: /Transcription language: Español/ }))
      .toHaveTextContent("ES");
  });

  it("cancelling throws the recording away and turns the microphone off", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel recording" }));

    expect(await screen.findByRole("button", { name: "Record a voice message" })).toBeInTheDocument();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("says so when the microphone is not allowed", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith([
        expect.stringContaining("Microphone access was denied"),
      ]),
    );
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("shows the one-time model download while it happens", async () => {
    let finish: (text: string) => void = () => {};
    vi.mocked(transcribeAudio).mockImplementation((_audio, _language, onPhase) => {
      onPhase?.({ kind: "loading", progress: 42.4 });
      return new Promise((resolve) => (finish = resolve));
    });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and transcribe" }));

    expect(
      await screen.findByText("Downloading the speech model (first time only)… 42%"),
    ).toBeInTheDocument();
    await act(async () => finish("listo"));
    await waitFor(() => expect(screen.getByTestId("input")).toHaveTextContent("listo"));
  });

  it("says so when nothing was said", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue("");
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and transcribe" }));

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(["No speech was recognized in the recording."]),
    );
  });

  it("an audio file picked with the clip is transcribed, not uploaded", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue("nota de voz");
    const { container } = render(<Harness />);
    const memo = new File(["x"], "memo.m4a", { type: "audio/mp4" });

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [memo] },
    });

    await waitFor(() => expect(screen.getByTestId("input")).toHaveTextContent("nota de voz"));
    expect(vi.mocked(transcribeAudio).mock.calls[0][0]).toBe(memo);
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });

  it("a failed transcription is reported with the file name", async () => {
    vi.mocked(transcribeAudio).mockRejectedValue(new Error("Unable to decode audio data"));
    const { container } = render(<Harness />);

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["x"], "broken.mp3", { type: "audio/mpeg" })] },
    });

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith([
        "Could not transcribe the file 'broken.mp3': Unable to decode audio data",
      ]),
    );
  });
});

describe("audio helpers", () => {
  it("mixes stereo down to mono, and always returns a fresh array", () => {
    const left = new Float32Array([1, 0, 0.5]);
    const right = new Float32Array([0, 1, 0.5]);
    expect(Array.from(toMono([left, right]))).toEqual([0.5, 0.5, 0.5]);

    const single = new Float32Array([0.25]);
    const mono = toMono([single]);
    expect(Array.from(mono)).toEqual([0.25]);
    expect(mono).not.toBe(single);
  });

  it("starts from the system language when it is offered, else the first one", () => {
    expect(defaultSpeechLanguage(["es-AR", "en-US"])).toBe("es");
    expect(defaultSpeechLanguage(["fr-FR", "en-GB"])).toBe("en");
    expect(defaultSpeechLanguage(["fr-FR"])).toBe("es");
  });

  it("a saved pick wins over the system language", () => {
    localStorage.setItem("hiveai.voice.language", "en");
    expect(defaultSpeechLanguage(["es-AR"])).toBe("en");
    localStorage.setItem("hiveai.voice.language", "klingon");
    expect(defaultSpeechLanguage(["es-AR"])).toBe("es");
  });

  it("switching goes round the offered languages", () => {
    expect(nextSpeechLanguage("es")).toBe("en");
    expect(nextSpeechLanguage("en")).toBe("es");
  });

  it("recognizes audio by type or, when the type is missing, by extension", () => {
    expect(isAudioFile(new File([""], "a.bin", { type: "audio/ogg" }))).toBe(true);
    expect(isAudioFile(new File([""], "Voice Memo.M4A"))).toBe(true);
    expect(isAudioFile(new File([""], "notes.txt", { type: "text/plain" }))).toBe(false);
  });
});

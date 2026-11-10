import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message, ModelSuggestion } from "../types";

const { changeModel } = vi.hoisted(() => ({ changeModel: vi.fn() }));

vi.mock("@/features/models/ModelsContext", () => ({
  useModels: () => ({ changeModel }),
}));
vi.mock("../ChatsContext.tsx", () => ({
  useChats: () => ({ activeChatId: "1", forkChat: vi.fn() }),
}));
vi.mock("@/lib/toastManager", () => ({ reportSuccess: vi.fn(), reportError: vi.fn() }));

import { ChatMessage } from "./ChatMessage";
import { ModelSuggestionFooter } from "./ModelSuggestionFooter";

const SUGGESTION: ModelSuggestion = {
  task: "code",
  taskLabel: "Code",
  suggestions: [],
  recommendations: [
    {
      id: "ollama:qwen2.5-coder:7b",
      ref: { provider: "ollama", model: "qwen2.5-coder:7b" },
      label: "qwen2.5-coder:7b",
      location: "local",
      reason: "Code-specialised model, free.",
      basis: "capabilities+cost",
      score: 0.85,
    },
    {
      id: "anthropic:claude-sonnet-4-5",
      ref: { provider: "anthropic", model: "claude-sonnet-4-5", keyId: "k1" },
      label: "claude-sonnet-4-5",
      location: "cloud",
      reason: "Very strong at code.",
      basis: "capabilities+cost",
      score: 0.8,
      estimatedCostUsd: 0.0135,
    },
  ],
};

const agentMessage = (over: Partial<Message> = {}): Message => ({
  id: "m1",
  role: "agent",
  content: "Here is the fix.",
  timestamp: 1,
  modelSuggestion: SUGGESTION,
  ...over,
});

describe("ModelSuggestionFooter", () => {
  beforeEach(() => vi.clearAllMocks());

  test("says what the user seems to be doing and lists the models with where they run, cost and reason", () => {
    render(<ModelSuggestionFooter suggestion={SUGGESTION} />);
    expect(screen.getByTestId("model-suggestion-task")).toHaveTextContent("code");

    const local = screen.getByTestId("model-suggestion-item-ollama:qwen2.5-coder:7b");
    expect(within(local).getByTestId("model-suggestion-location")).toHaveTextContent("Local");
    expect(within(local).queryByTestId("model-suggestion-cost")).toBeNull();
    expect(local).toHaveTextContent("Code-specialised model, free.");

    const cloud = screen.getByTestId("model-suggestion-item-anthropic:claude-sonnet-4-5");
    expect(within(cloud).getByTestId("model-suggestion-location")).toHaveTextContent("Cloud");
    expect(within(cloud).getByTestId("model-suggestion-cost")).toHaveTextContent("$0.01");
  });

  test("clicking a model switches to it, with its API key for cloud models", async () => {
    render(<ModelSuggestionFooter suggestion={SUGGESTION} />);
    await userEvent.click(screen.getByTestId("model-suggestion-item-anthropic:claude-sonnet-4-5"));
    expect(changeModel).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      keyId: "k1",
    });
  });

  test("with no model that fits it suggests installing or setting one up", () => {
    render(
      <ModelSuggestionFooter
        suggestion={{
          ...SUGGESTION,
          recommendations: [],
          suggestions: [
            { kind: "install", model: "gemma3:4b", reason: "Reads images locally." },
            { kind: "configure-cloud", provider: "anthropic", model: "Claude Sonnet", reason: "Add a key." },
          ],
        }}
      />,
    );
    expect(screen.queryByTestId(/model-suggestion-item-/)).toBeNull();
    expect(screen.getByTestId("model-suggestion-install")).toHaveTextContent("Install gemma3:4b");
    expect(screen.getByTestId("model-suggestion-configure-cloud")).toHaveTextContent("Claude Sonnet");
  });
});

describe("ChatMessage model suggestion", () => {
  test("shows under the latest answer", () => {
    render(<ChatMessage message={agentMessage()} isLast />);
    expect(screen.getByTestId("model-suggestion")).toBeInTheDocument();
  });

  test("is not shown under older answers", () => {
    render(<ChatMessage message={agentMessage()} isLast={false} />);
    expect(screen.queryByTestId("model-suggestion")).toBeNull();
  });

  test("is not shown on an error or a stopped answer", () => {
    const { rerender } = render(<ChatMessage message={agentMessage({ isError: true })} isLast />);
    expect(screen.queryByTestId("model-suggestion")).toBeNull();
    rerender(<ChatMessage message={agentMessage({ wasStopped: true })} isLast />);
    expect(screen.queryByTestId("model-suggestion")).toBeNull();
  });

  test("answers without a suggestion render as before", () => {
    render(<ChatMessage message={agentMessage({ modelSuggestion: undefined })} isLast />);
    expect(screen.queryByTestId("model-suggestion")).toBeNull();
  });
});

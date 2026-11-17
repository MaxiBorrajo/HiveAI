import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfigView } from "./ConfigView";

const LONG_PROMPT = [
  "You are a careful analyst.",
  "Read the report in ${draft}.",
  "List the three main risks.",
  "For each one, give a short mitigation.",
  "Answer in Spanish.",
  "Never invent figures.",
].join("\n");

describe("ConfigView", () => {
  it("shows each setting as a readable row instead of raw JSON", () => {
    render(
      <ConfigView
        config={{ model: "qwen3:8b", outputKey: "summary", maxTokens: 512, plugins: ["web_search", "file_read"] }}
      />,
    );

    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("qwen3:8b")).toBeInTheDocument();
    expect(screen.getByText("Output key")).toBeInTheDocument();
    expect(screen.getByText("Max tokens")).toBeInTheDocument();
    expect(screen.getByText("512")).toBeInTheDocument();
    expect(screen.getByText("web_search, file_read")).toBeInTheDocument();
    expect(screen.queryByText(/"model":/)).not.toBeInTheDocument();
  });

  it("cuts a long system prompt short, with real line breaks, and opens it on demand", () => {
    render(<ConfigView config={{ systemPrompt: LONG_PROMPT, outputKey: "risks" }} />);

    expect(screen.getByText("System prompt")).toBeInTheDocument();
    const prompt = screen.getByText(/You are a careful analyst/);
    expect(prompt.textContent).toBe(LONG_PROMPT);
    expect(prompt).toHaveClass("line-clamp-4");
    // What comes after the prompt is still right there.
    expect(screen.getByText("risks")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(prompt).not.toHaveClass("line-clamp-4");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(prompt).toHaveClass("line-clamp-4");
  });

  it("a short prompt is shown whole, with nothing to expand", () => {
    render(<ConfigView config={{ systemPrompt: "Summarize: ${draft}" }} />);

    expect(screen.getByText("Summarize: ${draft}")).not.toHaveClass("line-clamp-4");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("says when a setting is empty, and when there are none at all", () => {
    const { rerender } = render(<ConfigView config={{ systemPrompt: "", plugins: [] }} />);
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();

    rerender(<ConfigView config={{}} />);
    expect(screen.getByText("This node has no configuration.")).toBeInTheDocument();
  });

  it("nested settings stay as JSON, in a box of their own", () => {
    render(<ConfigView config={{ condition: { key: "score", op: ">", value: 3 } }} />);

    const box = screen.getByText(/"op": ">"/);
    expect(box.tagName).toBe("PRE");
    expect(box).toHaveClass("max-h-40", "overflow-auto");
  });
});

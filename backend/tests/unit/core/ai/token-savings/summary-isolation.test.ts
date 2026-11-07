import "@langchain/langgraph"; // initializes the async context LangChain uses to inherit callbacks
import { assertEquals } from "@std/assert";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { RunnableLambda } from "@langchain/core/runnables";
import { summarizerFromModel } from "../../../../../core/ai/token-savings/llm-summary.ts";

class Recorder extends BaseCallbackHandler {
  name = "recorder";
  starts = 0;
  override handleChatModelStart() {
    this.starts++;
  }
}

class FakeModel extends BaseChatModel {
  constructor(params: BaseChatModelParams = {}) {
    super(params);
  }
  _llmType() {
    return "fake";
  }
  _generate(_m: BaseMessage[]): Promise<ChatResult> {
    return Promise.resolve({
      generations: [{ text: "the summary", message: new AIMessage("the summary") }],
    });
  }
}

Deno.test("summary isolation - graph callbacks do not see the summarizer call", async () => {
  const parent = new Recorder();
  const own = new Recorder();
  const summarize = summarizerFromModel(new FakeModel({ callbacks: [own] }));

  const out = await RunnableLambda.from(() => summarize("long history")).invoke(
    {},
    { callbacks: [parent] },
  );

  assertEquals(out, "the summary");
  assertEquals(parent.starts, 0); // would stream to the user otherwise
  assertEquals(own.starts, 1); // usage recording on the model still works
});

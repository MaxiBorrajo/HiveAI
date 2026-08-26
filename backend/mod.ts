import { StateGraph, START, END } from "@langchain/langgraph";

// Test if LangGraph imports work correctly under Vite SSR
export function testGraph() {
  const graph = new StateGraph({
    channels: {
      messages: {
        value: (x: any, y: any) => x.concat(y),
        default: () => [],
      },
    },
  });

  console.log("LangGraph instantiated successfully:", graph !== undefined);
  return graph;
}

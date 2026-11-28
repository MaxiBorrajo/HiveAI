export const MAX_AGENT_ITERATIONS = 40;
export const MAX_AGENT_DURATION_MS = 10 * 60 * 1000;

// LangGraph counts every node run, and one agent iteration is an Agent run
// plus an Executor run. Without this the library default (25) cuts the turn
// off after ~12 tool rounds, before the agent's own budget can make it write
// a final answer. The extra steps cover the graph's entry/exit nodes.
export const SCOUT_RECURSION_LIMIT = MAX_AGENT_ITERATIONS * 2 + 10;

export interface GeneratorEvalCase {
  name: string;
  prompt: string;
  activePlugins: string[];
  expectedNodeTypes?: Array<"llm" | "plugin" | "condition">;
  minIntermediateNodes?: number;
  /** Spanish (Rioplatense) translation of `prompt`, used when --lang=es. */
  promptEs?: string;
}

export const generatorEvalCases: GeneratorEvalCase[] = [
  {
    name: "simple single-tool task: look up the current time",
    prompt: "Tell me what time it is right now.",
    promptEs: "Decime qué hora es ahora.",
    activePlugins: ["current_datetime"],
    expectedNodeTypes: ["llm"],
    minIntermediateNodes: 1,
  },
  {
    name: "search-then-summarize: requires an agentic llm node, not a bare plugin node",
    prompt:
      "Search the web for the latest news about renewable energy and write a short summary.",
    promptEs:
      "Buscá en la web las últimas noticias sobre energías renovables y escribí un resumen corto.",
    activePlugins: ["web_search"],
    expectedNodeTypes: ["llm"],
    minIntermediateNodes: 1,
  },
  {
    name: "search, extract, then save: two cognitive steps across a tool fetch and a file write",
    prompt:
      "Search the web for the current Bitcoin price, extract just the number, and save it to a file called btc_price.txt.",
    promptEs:
      "Buscá en la web el precio actual del Bitcoin, sacá solo el número, y guardalo en un archivo llamado btc_price.txt.",
    activePlugins: ["web_search", "file_ops"],
    expectedNodeTypes: ["llm", "plugin"],
    minIntermediateNodes: 2,
  },
  {
    name: "conditional branching: a numeric quality gate with a loop-back",
    prompt:
      "Draft a short product description, rate its quality from 1-10 as quality_score; if quality_score is 8 or higher, save it to a file and finish, otherwise rewrite it and check again.",
    promptEs:
      "Redactá una descripción corta de un producto, calificá su calidad del 1 al 10 como quality_score; si quality_score es 8 o más, guardala en un archivo y terminá, si no, reescribila y volvé a revisar.",
    activePlugins: ["file_ops"],
    expectedNodeTypes: ["llm", "condition"],
    minIntermediateNodes: 3,
  },
  {
    name: "explicit 'agent' wording forces an llm node even for a single tool",
    prompt: "Use an agent equipped with web_search to find today's top headline.",
    promptEs: "Usá un agente equipado con web_search para encontrar el título principal de hoy.",
    activePlugins: ["web_search"],
    expectedNodeTypes: ["llm"],
    minIntermediateNodes: 1,
  },
  {
    name: "end-to-end user-style request: research, read, decide, and file the result — phrased loosely, like a real ask",
    prompt:
      "I want a workflow that finds a competitor's pricing page, reads what's actually on it, figures out if their prices look higher or lower than ours, and writes a short note about it to a file so I can check later.",
    promptEs:
      "Quiero un flujo que encuentre la página de precios de un competidor, lea lo que dice de verdad, se fije si sus precios parecen más altos o más bajos que los nuestros, y escriba una nota corta sobre eso en un archivo para revisarlo después.",
    activePlugins: ["web_search", "web_read", "file_ops"],
    expectedNodeTypes: ["llm", "condition"],
    minIntermediateNodes: 3,
  },
  {
    name: "vague everyday request with an implicit loop: keep trying until it's good enough",
    prompt:
      "Make me a workflow that writes a tweet about our new feature, checks if it's under 280 characters, and keeps rewriting it until it fits, then saves the final version.",
    promptEs:
      "Armame un flujo que escriba un tweet sobre nuestra nueva función, revise si entra en 280 caracteres, y lo siga reescribiendo hasta que entre, y después guarde la versión final.",
    activePlugins: ["file_ops"],
    expectedNodeTypes: ["llm", "condition"],
    minIntermediateNodes: 3,
  },
  {
    name: "short casual ask mixing a stateful tool with a time-based one",
    prompt:
      "Set up something that logs a 'check-in' to my daily counter and tells me what time that happened.",
    promptEs:
      "Armame algo que registre un 'check-in' en mi contador diario y me diga a qué hora pasó eso.",
    activePlugins: ["counter", "current_datetime"],
    expectedNodeTypes: ["plugin"],
    minIntermediateNodes: 1,
  },
  {
    name: "dense multi-plugin chain: three tools across research, extraction, and persistence",
    prompt:
      "Search the web for today's weather in Buenos Aires, read the top result page to confirm the temperature, log the temperature to a counter called weather_log, and save a one-line summary to a file called weather.txt.",
    promptEs:
      "Buscá en la web el clima de hoy en Buenos Aires, leé la página del primer resultado para confirmar la temperatura, registrá la temperatura en un contador llamado weather_log, y guardá un resumen de una línea en un archivo llamado weather.txt.",
    activePlugins: ["web_search", "web_read", "counter", "file_ops"],
    expectedNodeTypes: ["llm", "plugin"],
    minIntermediateNodes: 3,
  },
  {
    name: "error-handling branch: a condition gates on whether the search actually found something",
    prompt:
      "Search the web for a company called 'Zzyzxqplorp Inc'. If you find real information about it, summarize it and save it to a file; if you find nothing useful, save a file saying no information was found instead.",
    promptEs:
      "Buscá en la web una empresa llamada 'Zzyzxqplorp Inc'. Si encontrás información real sobre ella, resumila y guardala en un archivo; si no encontrás nada útil, guardá un archivo diciendo que no se encontró información.",
    activePlugins: ["web_search", "file_ops"],
    expectedNodeTypes: ["llm", "condition"],
    minIntermediateNodes: 3,
  },
  {
    name: "structurally ambiguous request: a one-line ask that admits more than one reasonable graph shape",
    prompt: "Keep track of how many times I've asked you for the time.",
    promptEs: "Llevá la cuenta de cuántas veces te pedí la hora.",
    activePlugins: ["counter", "current_datetime"],
    expectedNodeTypes: ["plugin"],
    minIntermediateNodes: 1,
  },
  {
    name: "pedido nativo en español: investigar y registrar sin frase en inglés de referencia",
    prompt:
      "Quiero un flujo que busque en la web cuáles son las mejores prácticas para hacer code review, lea la página más relevante, y guarde un resumen de tres puntos en un archivo llamado code_review_tips.txt.",
    activePlugins: ["web_search", "web_read", "file_ops"],
    expectedNodeTypes: ["llm", "plugin"],
    minIntermediateNodes: 2,
  },
];

/**
 * Cases with no single exact expected output — graded by an LLM judge
 * against a rubric and/or a reference answer instead of exact-match
 * comparison. See judge.ts for how grading works.
 */
export interface JudgedEvalCase {
  name: string;
  query: string;
  queryEs?: string;
  /** Plugins active while this case runs. Usually none — these cases test
   *  the model's own generated text, not tool use. */
  activePlugins: string[];
  rubric?: string;
  referenceAnswer?: string;
  /**
   * Bump this whenever `rubric`/`referenceAnswer` changes meaningfully, so
   * runs against different versions aren't silently treated as comparable
   * (see the comparison tooling in the "export and compare" story).
   */
  rubricVersion: string;
}

export const judgedEvalCases: JudgedEvalCase[] = [
  {
    name: "summarization: condenses a long passage into a short, faithful summary",
    query:
      "Summarize the following paragraph in 2-3 sentences, keeping only the key facts:\n\n" +
      "The Amazon rainforest, spanning across nine countries in South America, is the " +
      "largest tropical rainforest in the world, covering roughly 5.5 million square " +
      "kilometers. It is home to an estimated 10% of the world's known species, including " +
      "jaguars, river dolphins, and thousands of plant species still undocumented by " +
      "science. The forest plays a critical role in regulating the global climate by " +
      "absorbing large amounts of carbon dioxide, but deforestation driven by cattle " +
      "ranching and agriculture has reduced its coverage by about 17% since 1970, " +
      "threatening both its biodiversity and its climate function.",
    queryEs:
      "Resumí el siguiente párrafo en 2 o 3 oraciones, manteniendo solo los datos clave:\n\n" +
      "La selva amazónica, que se extiende a lo largo de nueve países de Sudamérica, es el " +
      "bosque tropical más grande del mundo, con una superficie de aproximadamente 5,5 " +
      "millones de kilómetros cuadrados. Alberga alrededor del 10% de las especies " +
      "conocidas del mundo, incluyendo jaguares, delfines de río y miles de especies de " +
      "plantas aún no documentadas por la ciencia. El bosque cumple un rol fundamental en " +
      "la regulación del clima global al absorber grandes cantidades de dióxido de " +
      "carbono, pero la deforestación impulsada por la ganadería y la agricultura ha " +
      "reducido su cobertura en un 17% desde 1970, lo que amenaza tanto su biodiversidad " +
      "como su función climática.",
    activePlugins: [],
    rubric:
      "The summary is 2-3 sentences long, mentions the Amazon's size/location, mentions " +
      "its biodiversity, and mentions the deforestation threat. It does not invent facts " +
      "not present in the source paragraph.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: a short input should not be padded with invented detail",
    query:
      "Summarize this in one sentence: 'The meeting was rescheduled from Tuesday to " +
      "Thursday because the client requested more time to review the proposal.'",
    queryEs:
      "Resumí esto en una oración: 'La reunión se reprogramó de martes a jueves porque " +
      "el cliente pidió más tiempo para revisar la propuesta.'",
    activePlugins: [],
    referenceAnswer:
      "The meeting moved from Tuesday to Thursday so the client could have more time to " +
      "review the proposal.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: technical explanation is simplified for a non-technical reader",
    query:
      "Explain, in plain language a 10-year-old could understand, what an API is.",
    queryEs:
      "Explicá, en lenguaje simple que entendería alguien de 10 años, qué es una API.",
    activePlugins: [],
    rubric:
      "The explanation avoids jargon (no acronyms left unexplained, no deep technical " +
      "terms like 'endpoint' or 'protocol' without a plain-language gloss), uses an " +
      "accessible analogy, and is substantially correct about what an API does (lets " +
      "programs talk to each other / request information or actions from another " +
      "program).",
    rubricVersion: "v1",
  },
];

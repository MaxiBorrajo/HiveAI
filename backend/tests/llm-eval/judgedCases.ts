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
  {
    name: "summarization: an email thread becomes the decisions and who does what",
    query:
      "Summarize this email thread as a short list of decisions and action items, " +
      "each with its owner:\n\n" +
      "Ana: The launch moves to May 12. Marcos, can you update the landing page by Friday?\n" +
      "Marcos: Sure, Friday works. Should we still send the newsletter on the 10th?\n" +
      "Ana: No, send it on the 12th together with the launch. Lucía will write it.\n" +
      "Lucía: OK, I'll have a draft on Wednesday.",
    queryEs:
      "Resumí este hilo de mails como una lista breve de decisiones y tareas, cada una " +
      "con su responsable:\n\n" +
      "Ana: El lanzamiento pasa al 12 de mayo. Marcos, ¿podés actualizar la landing para el viernes?\n" +
      "Marcos: Sí, el viernes llego. ¿El newsletter lo seguimos mandando el 10?\n" +
      "Ana: No, mandalo el 12 junto con el lanzamiento. Lo escribe Lucía.\n" +
      "Lucía: Dale, el miércoles tengo un borrador.",
    activePlugins: [],
    rubric:
      "Lists the launch moving to May 12, Marcos updating the landing page by Friday, the " +
      "newsletter going out on the 12th (not the 10th), and Lucía writing it with a draft " +
      "on Wednesday. Every action has the right owner. Nothing is invented.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: numbers in a report are kept exact",
    query:
      "Summarize in two sentences: 'Third-quarter revenue was $4.2 million, up 18% from " +
      "the same quarter last year. Costs grew 9%, so the operating margin rose from 11% " +
      "to 16%. The company hired 34 people and expects similar growth next quarter.'",
    queryEs:
      "Resumí en dos oraciones: 'Los ingresos del tercer trimestre fueron de 4,2 millones " +
      "de dólares, un 18% más que el mismo trimestre del año anterior. Los costos " +
      "crecieron un 9%, por lo que el margen operativo pasó del 11% al 16%. La empresa " +
      "contrató a 34 personas y espera un crecimiento similar el próximo trimestre.'",
    activePlugins: [],
    rubric:
      "Two sentences. Keeps the figures exactly as given ($4.2 million, 18%, margin from " +
      "11% to 16%); any other figure it mentions is also exact. Does not round, change or " +
      "invent numbers.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: a strict word limit is respected",
    query:
      "Summarize in at most 15 words: 'Remote work grew sharply after 2020. Many " +
      "companies now offer hybrid schedules, which employees value for flexibility, " +
      "although some managers worry about collaboration and onboarding new staff.'",
    queryEs:
      "Resumí en 15 palabras como máximo: 'El trabajo remoto creció mucho después de " +
      "2020. Muchas empresas ofrecen ahora esquemas híbridos, que los empleados valoran " +
      "por la flexibilidad, aunque a algunos gerentes les preocupa la colaboración y la " +
      "incorporación de personal nuevo.'",
    activePlugins: [],
    rubric:
      "At most 15 words. Mentions the growth of remote or hybrid work and at least one " +
      "of the trade-offs (flexibility vs. collaboration or onboarding concerns).",
    rubricVersion: "v1",
  },
  {
    name: "summarization: meeting notes become a list of open questions",
    query:
      "From these meeting notes, list only the questions that were left open:\n\n" +
      "- Budget approved for the new server.\n" +
      "- Not decided: whether to hire a contractor or train an internal person.\n" +
      "- Migration date fixed for March 3.\n" +
      "- Pending: who will own the backups after the migration.",
    queryEs:
      "De estas notas de reunión, listá solo las preguntas que quedaron abiertas:\n\n" +
      "- Se aprobó el presupuesto para el servidor nuevo.\n" +
      "- Sin decidir: si contratar a alguien externo o capacitar a alguien interno.\n" +
      "- La migración quedó fijada para el 3 de marzo.\n" +
      "- Pendiente: quién se hace cargo de los backups después de la migración.",
    activePlugins: [],
    rubric:
      "Lists exactly the two open questions: contractor vs. training someone internal, and " +
      "who owns the backups after the migration. Does not list the decided items (budget, " +
      "March 3 date) as open.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: a missing fact is not filled in",
    query:
      "Summarize in one sentence, including the date of the event: 'The team will present " +
      "the new app at the Córdoba tech fair. Registration is free and open to everyone.'",
    queryEs:
      "Resumí en una oración, incluyendo la fecha del evento: 'El equipo va a presentar la " +
      "nueva app en la feria tecnológica de Córdoba. La inscripción es gratuita y abierta a " +
      "todo público.'",
    activePlugins: [],
    rubric:
      "One sentence about the presentation at the Córdoba tech fair with free, open " +
      "registration. The text gives no date: the answer must not invent one, and ideally " +
      "says that the date is not given.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: the conclusion of an argument is kept, not just the topic",
    query:
      "Summarize the author's position in one or two sentences: 'Many people think that " +
      "working longer hours means getting more done. However, studies on fatigue show that " +
      "productivity drops sharply after about 50 hours a week. For that reason, I believe " +
      "companies should cap overtime instead of rewarding it.'",
    queryEs:
      "Resumí la postura del autor en una o dos oraciones: 'Mucha gente cree que trabajar " +
      "más horas significa hacer más. Sin embargo, los estudios sobre fatiga muestran que " +
      "la productividad cae mucho después de unas 50 horas semanales. Por eso creo que las " +
      "empresas deberían limitar las horas extra en vez de premiarlas.'",
    activePlugins: [],
    rubric:
      "States the author's conclusion: companies should cap overtime rather than reward it, " +
      "because productivity drops after about 50 hours a week. It is not enough to say the " +
      "text is 'about working hours'.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: a product review becomes pros and cons",
    query:
      "Summarize this review as a short list of pros and cons: 'The headphones sound great " +
      "and the battery lasts two full days. Noise cancelling is decent but not the best. " +
      "They feel tight after an hour, and the app keeps asking me to log in.'",
    queryEs:
      "Resumí esta reseña como una lista breve de pros y contras: 'Los auriculares suenan " +
      "muy bien y la batería dura dos días enteros. La cancelación de ruido es correcta pero " +
      "no la mejor. Después de una hora aprietan, y la app me pide iniciar sesión todo el " +
      "tiempo.'",
    activePlugins: [],
    rubric:
      "Pros: sound quality and two-day battery. Cons: they get tight after an hour and the " +
      "app keeps asking to log in. Noise cancelling appears as average (in either list or " +
      "as a note), not as a clear strength. Nothing is invented.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: instructions keep their order",
    query:
      "Summarize these steps into a numbered list of at most four short steps: 'First, " +
      "unplug the router. Wait about thirty seconds so it fully powers off. Then plug it " +
      "back in and wait until the internet light turns green, which can take two minutes. " +
      "Finally, reconnect your computer to the Wi-Fi network.'",
    queryEs:
      "Resumí estos pasos en una lista numerada de cuatro pasos cortos como máximo: " +
      "'Primero, desenchufá el router. Esperá unos treinta segundos para que se apague del " +
      "todo. Después volvé a enchufarlo y esperá a que la luz de internet se ponga verde, " +
      "lo que puede tardar dos minutos. Por último, volvé a conectar la computadora a la " +
      "red Wi-Fi.'",
    activePlugins: [],
    rubric:
      "A numbered list of at most four steps in this order: unplug, wait about 30 seconds, " +
      "plug back in and wait for the green light, reconnect to Wi-Fi. No step is reordered " +
      "or dropped.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: a long explanation is shortened for a specific reader",
    query:
      "Summarize this for a busy manager in two sentences: 'Our test suite takes 40 minutes " +
      "because every test starts a fresh database. By sharing one database per test file " +
      "and resetting it between tests, a prototype brought the time down to 12 minutes. " +
      "The change needs about three days of work and carries a small risk of tests " +
      "affecting each other, which we can catch with a nightly full run.'",
    queryEs:
      "Resumí esto para un gerente con poco tiempo en dos oraciones: 'Nuestra suite de " +
      "tests tarda 40 minutos porque cada test levanta una base de datos nueva. Compartiendo " +
      "una base por archivo de tests y reseteándola entre tests, un prototipo bajó el tiempo " +
      "a 12 minutos. El cambio lleva unos tres días de trabajo y tiene un riesgo chico de que " +
      "los tests se afecten entre sí, que podemos detectar con una corrida completa nocturna.'",
    activePlugins: [],
    rubric:
      "Two sentences in plain language: tests drop from 40 to 12 minutes, the change takes " +
      "about three days, and there is a small, manageable risk. Avoids unnecessary " +
      "technical detail.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: an unrelated detail is left out",
    query:
      "Summarize in one sentence what the customer wants: 'Hi! I bought the blue jacket last " +
      "week, by the way your store is lovely. The jacket is too small, so I'd like to " +
      "exchange it for a size L. I still have the receipt.'",
    queryEs:
      "Resumí en una oración qué quiere el cliente: 'Hola! Compré la campera azul la semana " +
      "pasada, por cierto el local es hermoso. La campera me queda chica, así que me gustaría " +
      "cambiarla por un talle L. Todavía tengo el ticket.'",
    activePlugins: [],
    rubric:
      "One sentence saying the customer wants to exchange the blue jacket for a size L " +
      "because it is too small (keeping the receipt is optional). Leaves out the compliment " +
      "about the store.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: a summary in the language the user asked for",
    query:
      "Summarize the following Spanish text in English, in one sentence: 'La biblioteca " +
      "municipal amplía su horario: desde marzo abrirá también los sábados de 9 a 13.'",
    queryEs:
      "Resumí el siguiente texto en inglés, en una oración: 'The city library is extending " +
      "its hours: from March it will also open on Saturdays from 9 to 1.'",
    activePlugins: [],
    rubric:
      "One sentence, written in the language the request asks for (English for the English " +
      "query, Spanish for the Spanish one), saying the library will also open on Saturdays " +
      "from 9 to 1 starting in March.",
    rubricVersion: "v1",
  },
  {
    name: "summarization: contradictory information is flagged, not resolved by guessing",
    query:
      "Summarize the delivery situation in one or two sentences: 'The order was shipped on " +
      "Monday and will arrive Thursday. Update from the carrier: the package is still at " +
      "the warehouse and has not been shipped yet.'",
    queryEs:
      "Resumí la situación del envío en una o dos oraciones: 'El pedido se despachó el lunes " +
      "y llega el jueves. Actualización del correo: el paquete sigue en el depósito y todavía " +
      "no fue despachado.'",
    activePlugins: [],
    rubric:
      "Points out that the two pieces of information contradict each other (shipped on " +
      "Monday vs. still at the warehouse), or gives the latest update while noting the " +
      "earlier claim. Does not state as fact that it will arrive Thursday.",
    rubricVersion: "v1",
  },
];

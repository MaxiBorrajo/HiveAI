Las queries y plugins fueron hechos con IA y corregidos a mano para que sean lo más humanos posibles.

# Experimento: arquitecturas de decisión de ruteo en un agente local

Registro metodológico y resultados. Documenta el diseño, las corridas descartadas
y los hallazgos finales.

---

## Pregunta

Cuando un agente que corre sobre un modelo local tiene un catálogo amplio de
herramientas instaladas, ¿cómo conviene estructurar la decisión de cuál invocar?

Se comparan dos arquitecturas:

- **Tool-calling directo:** una única invocación. El catálogo completo se pasa
  por el mecanismo nativo de tool-calling del modelo, que elige herramienta y
  completa parámetros en un solo paso.
- **Pipeline de decisión:** dos invocaciones encadenadas. Un *selector* recibe el
  catálogo y devuelve un nombre de herramienta o `NINGUNO_APLICA`, restringido
  por un enum. Un *parametrizador* recibe únicamente el esquema de la herramienta
  ya elegida y completa sus parámetros. Si el selector se abstiene, la segunda
  invocación no ocurre.

### Hipótesis

**H1 (degradación).** La precisión de selección cae a medida que crece la
cantidad de herramientas disponibles.

**H2 (arquitectura).** Descomponer la decisión en dos pasos angostos mejora la
precisión respecto de una única invocación, a costa de más tokens y más latencia.

Ambas se declararon refutables antes de correr. **Ambas resultaron refutadas.**

---

## Configuración

| | |
|---|---|
| Modelo | `qwen3:8b` vía Ollama |
| `temperature` | 0.0 |
| `think` | false |
| `num_ctx` | 8192 (explícito) |
| Runtime | Deno |
| Framework | LangChain (`@langchain/ollama`, `@langchain/core`) |
| Repeticiones | 5 por consulta y configuración |

**Hardware:** *(completar: CPU, RAM, GPU)*

La latencia absoluta depende del hardware y no es comparable entre máquinas.
Todos los resultados reportados provienen del mismo equipo. Solo los valores
relativos entre estrategias son interpretables.

`total_duration` de Ollama incluye `load_duration`. Se resta antes de registrar
`duration_ms`, de modo que la métrica refleja tiempo de inferencia y no de carga
del modelo a memoria.

---

## Catálogo

30 plugins simulados. Cada uno tiene nombre, descripción y esquema de zod con
`.describe()` en todos sus campos. El `process()` no se ejecuta: el experimento
mide la decisión, no el resultado.

Las descripciones declaran explícitamente qué **no** hace cada plugin cuando
existe otro que podría confundirse. Ese diseño es lo que hace decidibles los
pares limítrofes:

| Par | Diferencia declarada |
|---|---|
| `file_search` / `content_search` | por nombre de archivo / dentro del contenido |
| `file_search` / `directory_list` | con patrón, recursivo / listado inmediato |
| `file_read` / `json_read` | archivo completo / valor puntual |
| `file_read` / `file_metadata` | contenido / tamaño, fecha, permisos |
| `process_list` / `system_metrics` | qué procesos corren / cuánto consume la máquina |
| `host_ping` / `port_scan` | si el host responde / qué puertos escucha |
| `code_lint` / `code_format` | detecta errores / cambia el formato |
| `shell_exec` / específicos | tareas de sistema sin plugin propio |

---

## Set de consultas

41 consultas en español rioplatense, escritas como las escribiría un
desarrollador. Ninguna nombra la herramienta esperada ni repite textualmente
palabras de su nombre, para no medir coincidencia de cadenas.

| Categoría | Cantidad | Qué mide |
|---|---|---|
| `DIRECTA` | 19 | Una sola herramienta aplica sin ambigüedad |
| `AMBIGUA` | 13 | Dos podrían servir; la exclusión declarada decide |
| `PARAMS_IMPLICITOS` | 4 | La herramienta es clara, un parámetro hay que inferirlo |
| `SIN_MATCH` | 5 | Ninguna aplica; corresponde abstenerse |

Las `SIN_MATCH` son irresolubles con las 30 herramientas, no solo con algunas:
requieren juicio técnico, credenciales ausentes o servicios que el catálogo no
cubre.

Seis consultas están marcadas con `free_text_params`: sus parámetros incluyen
texto libre (el cuerpo de un issue, el contenido de un mensaje, el SQL exacto)
que no puede acertarse literalmente. Se excluyen de la métrica de parámetros.

**Procedencia.** El set fue generado con asistencia de un modelo distinto al
evaluado y revisado manualmente consulta por consulta, cruzando cada una contra
los 30 plugins para verificar que la respuesta esperada sea única.

---

## Métricas

Tres métricas independientes, no colapsadas en un único número: un modelo puede
acertar la herramienta y alucinar los argumentos, y esa distinción es lo que
interesa medir.

- **`selection_correct`** — la herramienta elegida coincide con la esperada; en
  `SIN_MATCH`, que se haya abstenido. Un error de formato nunca cuenta como
  acierto.
- **`params_valid`** — los parámetros pasan el `safeParse` del esquema.
- **`params_correct`** — comparación campo por campo contra lo esperado. Con
  `strictDefaults: true`: un campo que el modelo agregó por su cuenta debe
  respetar el valor por defecto del esquema.

Señales adicionales: `abstained` (decisión), `format_error` (falla),
`hallucinated_plugin` (nombre fuera del catálogo), `multiple_tool_calls`.

La distinción entre `abstained` y `format_error` es deliberada: abstenerse es
una decisión correcta en las `SIN_MATCH`; un fallo de formato es un defecto.

---

## Resultados

Catálogo completo de 30 plugins, 41 consultas, 5 repeticiones. N = 205 por
estrategia.

| | Tool-calling | Pipeline |
|---|---|---|
| Selección correcta | **170 / 205 (83%)** | 156 / 205 (76%) |
| Parámetros correctos | **90** | 81 |
| Abstenciones | 60 | 69 |
| Elecciones erróneas | **0** | 5 |
| Errores de formato | 0 | 0 |
| Alucinaciones de plugin | 0 | 0 |
| Tokens promedio | **3187** | 4142 |
| Latencia promedio | **535 ms** | 685 ms |

### H2 refutada

El tool-calling directo supera al pipeline en las cuatro dimensiones. Además, el
conjunto de consultas que falla el tool-calling está estrictamente contenido en
el que falla el pipeline: las mismas siete, más tres adicionales.

Descomponer la decisión costó un 30% más de tokens y un 28% más de latencia sin
ninguna ganancia de precisión.

### H1 refutada

Un 83% de acierto con treinta herramientas disponibles no constituye un colapso.
Corridas previas con catálogos de 3, 8, 15 y 30 tampoco mostraron una curva de
degradación una vez saneado el set de consultas.

### Hallazgo principal: el modo de falla es la abstención

De las 60 abstenciones del tool-calling, 25 corresponden a las cinco consultas
`SIN_MATCH` (correctas). Las 35 restantes coinciden exactamente con sus 35
fallos.

**Todos los errores del tool-calling son abstenciones. No hubo una sola elección
de herramienta incorrecta en 205 invocaciones con un catálogo de 30.**

Esto difiere del modo de falla que suele describirse en la literatura sobre
catálogos extensos, donde se reporta confusión entre herramientas y alucinación
de invocaciones. En esta configuración el modelo no se confunde: se abstiene.

Las cinco consultas `SIN_MATCH` se resolvieron correctamente 5/5 en ambas
estrategias. El mecanismo de abstención funciona cuando corresponde; el problema
es que se dispara también cuando no corresponde.

### Hallazgo secundario: los fallos correlacionan con el registro lingüístico

Las siete consultas que fallan en ambas estrategias comparten una característica
que no es el dominio ni la cantidad de herramientas, sino cómo están escritas:

| Consulta | Fraseo | Herramienta esperada |
|---|---|---|
| q10 | "ese bicho 4052... aniquilalo" | `process_kill` |
| q12 | "pasale el verificador" | `unit_test` |
| q13 | "subí al remoto el commit" | `git_exec` |
| q14 | "rastrealo en la lógica" | `content_search` |
| q16 | "en qué puerto escucha la base...?" | `file_read` |
| q30 | "va a llover mañana en Buenos Aires?" | `weather_forecast` |
| q35 | "consultá el almacén local.data" | `db_query` |

El patrón: **el modelo rutea de forma confiable ante imperativos directos con
vocabulario literal, y se abstiene ante preguntas o ante vocabulario coloquial y
metafórico.** El caso más claro es q30: existe un plugin de clima, la pregunta es
directa en su intención, y aun así ambas estrategias se abstienen.

Esto sugiere que la intervención efectiva no es filtrar el catálogo sino
normalizar el fraseo del pedido antes de rutear. Queda como hipótesis a medir.

---

## Corridas descartadas

Se documentan porque los errores encontrados son en sí mismos resultados
metodológicos.

**Truncado silencioso por contexto.** Las primeras corridas del pipeline con
catálogo de 30 reportaban aproximadamente los mismos tokens de entrada que con
catálogo de 15. El `num_ctx` por defecto de Ollama (2048) truncaba el prompt del
selector sin emitir advertencia alguna, y el modelo elegía sobre medio catálogo.
El tool-calling no lo sufría porque las herramientas viajan por otro canal. Se
detectó comparando el rango de tokens entre configuraciones: con catálogo de 30
la dispersión era de 66 tokens en 60 invocaciones, contra 428 con catálogo de 15.

**Distractores que resolvían consultas del set.** El primer catálogo incluía
plugins (`unit_test`, `json_read`, `slack_message`, `http_request`) que
resolvían legítimamente consultas etiquetadas para otra herramienta o como
`SIN_MATCH`. El resultado esperado dejaba de ser invariante al tamaño del
catálogo, y una degradación aparente resultó ser el efecto de esas etiquetas.
Se detectó solo al desglosar por consulta: el promedio agregado no lo mostraba.

**Asimetría en los prompts.** El prompt del selector contenía seis reglas, cuatro
de las cuales empujaban a abstenerse. Con catálogo de 3 plugins y 900 tokens de
prompt, el selector se abstenía en consultas triviales que el tool-calling
resolvía sin dificultad. Acortarlo a dos líneas movió aproximadamente 10 puntos
sobre 60. Los prompts de ambas estrategias se emparejaron al mínimo común antes
de la corrida final.

**Determinismo a temperatura 0.** En una corrida de 240 veredictos, una sola
consulta varió entre repeticiones. Las 5 repeticiones aportan poco; el tiempo
rinde más invertido en ampliar el set de consultas.

---

## Limitaciones

1. **Un solo modelo.** Los resultados no se generalizan a otros modelos locales
   ni a modelos cloud.
2. **Un solo set de consultas, de tamaño moderado.** 41 consultas: cada una pesa
   2,4% del resultado.
3. **Plugins simulados.** Las descripciones fueron escritas con exclusiones
   explícitas para hacer decidibles los pares limítrofes. Un catálogo real de
   plugins de terceros tendría descripciones de calidad desigual, lo cual
   probablemente empeoraría el ruteo.
4. **Un solo evaluador.** Los valores esperados fueron definidos por una sola
   persona. En las consultas ambiguas otra persona podría discrepar
   razonablemente.
5. **Idioma.** Todas las consultas están en español rioplatense. El hallazgo
   sobre registro lingüístico podría no trasladarse a otros idiomas o registros.
6. **Las descripciones son una variable no controlada.** Medir la sensibilidad
   del ruteo a su calidad requiere un experimento aparte.

---

## Conclusiones para el producto

1. **No hace falta filtrar el catálogo en esta escala.** Con 30 herramientas el
   tool-calling nativo sostiene un 83% de acierto sin ninguna técnica de
   mitigación. El filtrado por recuperación semántica queda como línea a evaluar
   con catálogos mayores, no como necesidad inmediata.

2. **La descomposición de la decisión no se adopta.** No mejoró la precisión y
   duplicó el costo. HiveQueen usa tool-calling directo.

3. **El problema a atacar es la sobre-abstención ante fraseo indirecto.** Es
   donde está el 100% de los errores, y sugiere trabajar sobre la normalización
   del pedido antes del ruteo, no sobre la arquitectura de decisión.

4. **La configuración del cliente importa tanto como la arquitectura.** Un
   `num_ctx` implícito truncó prompts en silencio durante varias corridas. En
   producción, cualquier parámetro de contexto debe fijarse explícitamente.

---

## Reproducir

```bash
deno task experiment --strategy tool-calling --catalog 30 --runs 5
deno task experiment --strategy pipeline --catalog 30 --runs 5
```

Los resultados se escriben en `results/` como JSONL, un veredicto por línea, con
`strategy`, `catalog_size` y `run` en cada registro. Los archivos de resultados
se conservan versionados: son la evidencia del informe.
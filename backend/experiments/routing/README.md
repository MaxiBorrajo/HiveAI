# Experimento: degradación del ruteo y comparación de arquitecturas de decisión

Registro metodológico. **Se escribe antes de correr y no se modifica después.**
Cualquier cambio posterior a haber visto resultados invalida el experimento.

---

## Hipótesis

**H1 (degradación).** La calidad de decisión de un modelo local cae a medida
que crece la cantidad de herramientas disponibles, aunque la respuesta
correcta siga estando entre las mismas tres. Esperamos que el acierto de
selección se mantenga alto con catálogos chicos y se degrade con catálogos
grandes, y que la degradación sea más pronunciada en las consultas ambiguas y
en las que requieren abstenerse.

**H2 (arquitectura).** Descomponer la decisión en dos pasos angostos —elegir
herramienta primero, completar parámetros después— produce mejor acierto que
una única invocación con tool-calling nativo, a costa de más tokens y más
latencia. Esperamos que la ventaja sea nula o negativa con catálogos chicos y
aparezca con catálogos grandes.

Ambas hipótesis pueden refutarse. Un resultado que muestre que el
tool-calling directo aguanta bien es un hallazgo válido y se reporta como tal.

---

## Configuración

| | |
|---|---|
| Modelo | `qwen3:8b` vía Ollama |
| `temperature` | 0.0 |
| `think` | false |
| `num_ctx` | *(completar con el valor efectivo)* |
| Runtime | Deno |
| Framework | LangChain (`@langchain/ollama`, `@langchain/core`) |

**Hardware:** *(completar: CPU, RAM, presencia o ausencia de GPU)*

La latencia absoluta depende del hardware y **no es comparable entre
máquinas**. Todas las corridas reportadas deben provenir del mismo equipo. Una
corrida preliminar en otra máquina arrojó ~640 ms por invocación contra ~5000
ms en esta; solo los valores relativos entre estrategias son interpretables.

`total_duration` de Ollama incluye `load_duration` (carga del modelo a
memoria). Se resta antes de registrar `duration_ms`, de modo que la métrica
refleja tiempo de inferencia y no de arranque del runtime.

---

## Diseño del catálogo

30 plugins simulados. Cada plugin tiene nombre, descripción y schema de zod
con `.describe()` en todos sus campos. El `process()` no se ejecuta: el
experimento mide la decisión, no el resultado.

**Subconjuntos anidados.** Las configuraciones de 3, 8, 15 y 30 son los
primeros N del array, en orden fijo. El orden no varía entre corridas.

**Los tres primeros son los únicos objetivos válidos:**

1. `file_search` — busca archivos por patrón de nombre
2. `shell_exec` — ejecuta un comando de shell
3. `file_read` — lee el contenido de un archivo

Los 27 restantes son distractores plausibles del mismo universo. **Ninguno
resuelve una consulta del set.** Seis de ellos son de dominio deliberadamente
cercano a los tres primeros, para medir si el modelo distingue casos
limítrofes.

**Por qué todos los objetivos están en los primeros tres.** El resultado
esperado de cada consulta debe ser invariante al tamaño del catálogo. Si un
plugin objetivo apareciera recién en la configuración de 15, no estaríamos
midiendo degradación por ruido sino disponibilidad, y el mismo set daría
veredictos distintos según la configuración.

**Consecuencia y limitación.** El experimento mide la capacidad de elegir
entre tres objetivos correctos con N distractores. No mide qué ocurre cuando
hay 30 objetivos posibles distintos. Esa es una pregunta legítima pero
distinta, y requiere otro diseño.

**Precedencia declarada.** La descripción de `shell_exec` indica
explícitamente que debe usarse solo cuando ninguna otra herramienta cubra la
tarea. Sin esa cláusula, `shell_exec` absorbe casi cualquier consulta y las
categorías AMBIGUA y SIN_MATCH pierden sentido. Las descripciones son una
variable del experimento y quedan congeladas junto con este documento.

---

## Set de consultas

Escritas en español rioplatense, informales, sin nombrar nunca la herramienta
esperada. Ninguna consulta contiene palabras que aparezcan textuales en el
nombre del plugin esperado, para no medir coincidencia de strings.

| Categoría | Cantidad | Qué mide |
|---|---|---|
| `DIRECTA` | 3 | Una sola herramienta aplica sin ambigüedad |
| `AMBIGUA` | 3 | Dos herramientas podrían servir; la precedencia decide |
| `SIN_MATCH` | 3 | Ninguna herramienta aplica; corresponde abstenerse |
| `PARAMS_IMPLICITOS` | 3 | La herramienta es clara, un parámetro hay que inferirlo |

**Las SIN_MATCH son irresolubles con las 30 herramientas**, no solo con las
tres primeras. Requieren juicio (una recomendación técnica), un canal externo
(mensajería al equipo) o información que no vive en la máquina local (la
versión actual de un runtime).

**Procedencia.** El set fue generado con asistencia de un modelo de lenguaje
distinto al evaluado, y revisado y corregido manualmente consulta por
consulta. Se declara como limitación metodológica.

El set está versionado en el repositorio y **no se modifica una vez iniciadas
las corridas**. Si en el futuro se agregan consultas, constituyen un set v2 y
se reportan por separado.

---

## Criterios de acierto

Tres métricas independientes. No se colapsan en un único número: un modelo
puede acertar la herramienta y alucinar los argumentos, y esa distinción es
justamente lo que interesa medir.

**`selection_correct`**
Con `expected_plugin` no nulo: la herramienta elegida coincide exactamente.
Con `expected_plugin` nulo (SIN_MATCH): el modelo se abstuvo.
Un error de formato nunca cuenta como selección correcta.

**`params_valid`**
Los parámetros devueltos pasan el `safeParse` del schema de la herramienta
esperada. Es `null` cuando la selección fue incorrecta o hubo abstención.

**`params_correct`**
Comparación campo por campo contra `expected_params`. Solo se evalúa si
`params_valid` es verdadero.

### `strictDefaults: true`

Los schemas declaran como obligatorios también los campos con valor por
defecto, de modo que el modelo siempre completa todos los campos, incluso los
que el pedido no menciona.

Con `strictDefaults` activo, un campo que el modelo agregó por su cuenta debe
coincidir con el valor por defecto declarado en el schema. Si el pedido no
menciona un límite de resultados y el modelo escribe `limit: 100` cuando el
default es `50`, cuenta como parámetro incorrecto.

**Justificación.** El modelo inventó un valor que nadie pidió. En producción
eso cambia el comportamiento de la herramienta, y es exactamente el tipo de
error que interesa detectar. El criterio se fija antes de correr y no se
revisa según los resultados.

### Señales adicionales

- `abstained` — no se eligió herramienta (decisión, no falla)
- `format_error` — la salida no pudo parsearse o validarse (falla, no decisión)
- `hallucinated_plugin` — se eligió un nombre que no está en el catálogo
- `multiple_tool_calls` — se devolvió más de una invocación; se toma la primera

La distinción entre `abstained` y `format_error` es deliberada: abstenerse es
una decisión correcta en las SIN_MATCH, mientras que un fallo de formato es un
defecto del modelo o de la integración.

---

## Estrategias comparadas

**`tool-calling`** — una invocación. El catálogo llega por `bindTools`. La
abstención se detecta por ausencia de `tool_calls`, independientemente del
texto de la respuesta.

**`pipeline`** — dos invocaciones encadenadas. La primera (selector) recibe el
catálogo serializado y devuelve un nombre o `NINGUNO_APLICA`, restringido por
un `z.enum`. La segunda (parametrizador) recibe **únicamente** el schema de la
herramienta ya elegida y completa sus parámetros. Si el selector se abstiene,
la segunda invocación no ocurre.

**Paridad de información.** Ambas estrategias reciben el mismo contenido:
nombre, descripción y parámetros con sus descripciones, en el mismo orden. La
diferencia en tokens de prompt entre ambas se verifica antes de correr y se
mantiene mínima; una asimetría grande invalidaría la comparación.

---

## Corridas

5 repeticiones por consulta y configuración. `temperature: 0` no garantiza
determinismo en Ollama, de modo que se reporta dispersión además de promedio.
Una diferencia entre estrategias que caiga dentro de la dispersión no se
interpreta como significativa.

### Spike 1 — degradación por tamaño de catálogo

```
--strategy tool-calling --catalog 3  --runs 5
--strategy tool-calling --catalog 8  --runs 5
--strategy tool-calling --catalog 15 --runs 5
--strategy tool-calling --catalog 30 --runs 5
```

### Spike 2 — comparación de arquitecturas

```
--strategy pipeline --catalog 15 --runs 5
--strategy pipeline --catalog 30 --runs 5
```

Se comparan contra las corridas equivalentes de `tool-calling` del spike 1.
Los catálogos chicos se omiten porque no se espera diferencia; si el spike 1
mostrara degradación temprana, se agregan.

---

## Resultados

Un archivo JSONL por corrida en `results/`, un veredicto por línea. Cada
veredicto incluye `strategy`, `catalog_size` y `run`, de modo que un único
archivo puede contener varias configuraciones y filtrarse después.

Los resultados crudos se conservan versionados: son la evidencia del informe,
no un producto intermedio descartable.

---

## Limitaciones conocidas

Declaradas antes de correr, no descubiertas después.

1. **Un solo modelo.** Los resultados no se generalizan a otros modelos
   locales ni a modelos cloud. La comparación entre modelos es un experimento
   distinto.

2. **Un solo set de consultas, de tamaño reducido.** 12 consultas en el
   piloto. Con esa cantidad, una diferencia de pocos puntos porcentuales no
   es interpretable.

3. **Plugins simulados.** Las descripciones son plausibles pero no provienen
   de un ecosistema real de plugins. Un catálogo real tendría descripciones de
   calidad más desigual, lo cual probablemente empeoraría el ruteo.

4. **Tres objetivos válidos únicamente.** Ver "Diseño del catálogo".

5. **Un solo evaluador.** Los `expected_plugin` y `expected_params` fueron
   definidos por una sola persona. En las consultas ambiguas y de parámetros
   implícitos, otra persona podría discrepar razonablemente.

6. **Inferencias dependientes del stack.** Al menos una consulta de
   `PARAMS_IMPLICITOS` espera un archivo de configuración cuya convención es
   específica de este proyecto. Esa consulta mide adivinanza de stack más que
   inferencia general, y debe interpretarse con cautela.

7. **Descripciones de herramientas como variable no controlada.** El
   experimento fija un conjunto de descripciones. Medir la sensibilidad del
   ruteo a la calidad de las descripciones requiere un experimento aparte —
   uno que se desprende naturalmente de este.

---

## Qué se decide con estos resultados

- **Si hay degradación clara:** queda fundamentado el argumento de partición
  del catálogo entre subagentes especializados, que hoy figura como línea de
  trabajo futuro.
- **Si el pipeline gana:** pasa a ser la arquitectura por defecto de
  HiveQueen, y hay que evaluar el impacto sobre el código ya escrito.
- **Si no hay diferencia significativa:** se documenta, se adopta
  tool-calling directo por simplicidad, y se replantea el diferencial del
  proyecto en función de lo que la evidencia sí respalda.
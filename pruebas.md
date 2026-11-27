Todos los casos para tus keys de **Claude** y **Gemini** (son los dos proveedores que quedaron). Con US$1 por key alcanza de sobra si seguís las indicaciones de costo.

## 0. Preparación

| | |
|---|---|
| Modelos baratos | Claude `claude-haiku-4-5`, Gemini `gemini-2.5-flash`. Para ver thinking: `claude-sonnet-5-5` (más caro, usalo poco) |
| Prompts | Cortos ("Respondé solo: hola"). Evitá pegar documentos largos |
| Requisitos | `deno task dev` corriendo, Ollama levantado con `nomic-embed-text` (se usa para memoria del chat aunque el modelo sea cloud) y al menos un modelo local para las pruebas de mix |
| Logs | Tené a la vista la consola del backend: de ahí salen los `[SCOUT - Agent]` y `[Compiler Native LLM]` que se mencionan abajo |
| Para el grep de seguridad | Anotá los **últimos 8 caracteres** de cada key. No pegues la key entera en la terminal |

## A. Gestión de keys

| # | Pasos | Esperado |
|---|---|---|
| A1 | Menú de modelos → "API keys..." → Add key → Anthropic, alias "Claude – personal", pegar la key | Se guarda. Aparece `••••xxxx` y badge "Anthropic" |
| A2 | Igual con Google Gemini, alias "Gemini – personal" | Se guarda |
| A3 | Provider Anthropic con valor inventado (`sk-ant-xxxxxxxx`) | Error inline "provider rejected this API key". No queda en la lista |
| A4 | Sin internet, intentar guardar una key | Error "Could not reach the provider…". No se guarda |
| A5 | Segunda key Anthropic "Claude – trabajo" (podés repetir el mismo valor) | Se guarda, hay 2 keys Anthropic |
| A6 | Otra key Anthropic con alias "claude – personal" | Rechaza por alias duplicado (no distingue mayúsculas) |
| A7 | Alias vacío o de más de 60 caracteres | Error de validación |
| A8 | Editar → cambiar solo el alias | Cambia. El valor sigue funcionando (probalo en el chat) |
| A9 | Editar → reemplazar el valor por uno inválido | Error. La key anterior sigue funcionando |
| A10 | Editar → reemplazar por un valor válido | Cambia el `••••xxxx` |
| A11 | Cerrar y reabrir la app → abrir "API keys..." | Las keys siguen, siempre enmascaradas |
| A12 | Inspeccionar en el navegador (DevTools → red) la respuesta de `GET /api/api-keys` | Nunca aparece el valor completo, solo `masked` |

## B. Selector y agrupación

| # | Pasos | Esperado |
|---|---|---|
| B1 | Abrir el menú de modelos | Grupos: "Local (Ollama)", "Anthropic · Claude – personal", "Anthropic · Claude – trabajo", "Google Gemini · Gemini – personal" |
| B2 | Mirar los modelos dentro de cada grupo de Anthropic y de Google | Aparecen modelos reales de tu cuenta, no una lista fija |
| B3 | Revocar una key en la consola del proveedor y reabrir el menú | Ese grupo aparece con ⚠ y sin modelos. Pasar el mouse muestra el motivo. Los otros grupos funcionan |
| B4 | Elegir un modelo de cada grupo | El check se mueve al elegido. Con dos keys del mismo proveedor, el check queda en la key correcta |
| B5 | Con un modelo cloud seleccionado | El botón de modos (contexto/KV cache) desaparece. El icono del menú cambia a nube |
| B6 | Volver a un modelo local | Reaparecen los modos |
| B7 | Reiniciar la app | Se conserva el modelo, el proveedor y la key elegidos |

## C. Chat de punta a punta

| # | Pasos | Esperado |
|---|---|---|
| C1 | Haiku: "Respondé solo: hola" | Respuesta en streaming, token a token |
| C2 | Gemini flash: lo mismo | Streaming correcto |
| C3 | Local: lo mismo | Sigue funcionando como antes |
| C4 | Con un plugin activo, pedirle a Claude algo que requiera la herramienta | Llama al plugin, muestra el paso y responde con el resultado |
| C5 | Lo mismo con Gemini | Idem |
| C6 | Conversación de 3 mensajes con Claude y luego pasar a Gemini a mitad | Gemini responde y el historial se mantiene |
| C7 | Stop en medio de una respuesta larga | Se corta sin error |
| C8 | Mismo modelo con la key "trabajo" y con la "personal" | Funciona con las dos. En el panel de uso de Anthropic, cada una muestra su propio consumo |

## D. Thinking

| # | Pasos | Esperado |
|---|---|---|
| D1 | `claude-sonnet-5-5`: "¿Cuánto es 17×23? Pensalo paso a paso" | Aparece el bloque de razonamiento (resumido) y luego la respuesta |
| D2 | `claude-haiku-4-5` con el mismo prompt | Responde bien. Puede no mostrar razonamiento |
| D3 | Con Haiku mirar los logs | Si el modelo rechazó thinking, se ve `rejected thinking, retrying without it` y el chat responde igual, sin error |
| D4 | Mandar un segundo mensaje con Haiku | No aparece de nuevo el aviso (el rechazo se recuerda hasta reiniciar) |
| D5 | Gemini flash | Responde sin bloque de razonamiento, sin errores |

## E. Errores de proveedor (el chat debe seguir usable)

| # | Pasos | Esperado |
|---|---|---|
| E1 | Revocar la key en la consola y mandar un mensaje | Mensaje claro: "The API key was rejected by the provider… Check or replace it" |
| E2 | Cortar internet y mandar un mensaje cloud | "Could not reach the provider" |
| E3 | Borrar la key que usa el chat (confirmar "Delete anyway") y mandar un mensaje | Error claro: "API key … no longer exists" |
| E4 | Tras cada error, cambiar a otro modelo y mandar un mensaje | Funciona normal, el chat no queda roto |

## F. Ejecuciones

Armá una ejecución de 3 nodos de IA (ej.: resumir → clasificar → redactar).

| # | Pasos | Esperado |
|---|---|---|
| F1 | Con Claude seleccionado en el chat, generar la ejecución con HiveQueen | Se genera. Cada nodo tiene un modelo asignado |
| F2 | Abrir cada nodo → campo Model | Muestra el modelo propuesto, agrupado por key. La propuesta es razonable (modelos livianos/locales para pasos simples) |
| F3 | En los logs, buscar `is not one of the available models` | Si aparece, el generador reintentó y al final usó el modelo por defecto. El nodo igual quedó configurado |
| F4 | Cambiar a mano: nodo 1 Claude, nodo 2 Gemini, nodo 3 local | Se guarda sin error |
| F5 | Ejecutar con un input corto | Corre completo. En los logs: `Executing model: …` con el modelo de cada nodo |
| F6 | Dos nodos Claude con keys distintas ("personal" y "trabajo") | Ambos corren. El uso se reparte en los dos paneles |
| F7 | Reiniciar la app y reabrir la ejecución | Los modelos y keys por nodo siguen igual |
| F8 | Modificar un nodo (otro modelo), guardar, y mirar la versión anterior (si la UI la muestra) | Cada versión conserva su configuración |
| F9 | Dejar un nodo en "Default model" y ejecutar | Usa el modelo seleccionado en el chat |
| F10 | Pedirle a HiveQueen que reconfigure un nodo que ya tiene modelo ("cambiá el prompt para que sea más corto") | Conserva el modelo que tenía, salvo que lo pidas |
| F11 | Revocar la key de Gemini y ejecutar un grafo con un nodo Gemini | El nodo muestra el error del proveedor en su salida. La ejecución no se rompe por completo |
| F12 | Nodo con un modelo cloud y opciones de Ollama puestas a mano (ej.: `numCtx` en la config) | Se ignoran sin error |

## G. Borrado de keys en uso

| # | Pasos | Esperado |
|---|---|---|
| G1 | Borrar una key usada por un nodo de una ejecución | Aviso: "used by 'NombreEjecución' (N nodes)" con "Keep it" y "Delete anyway" |
| G2 | "Keep it" | No se borra |
| G3 | "Delete anyway" y abrir esa ejecución | El nodo muestra "(unavailable)" y el mensaje en rojo |
| G4 | Ejecutarla | **No arranca**. El mensaje indica qué nodo y por qué |
| G5 | Abrir resultados de ejecuciones anteriores | El historial sigue intacto |
| G6 | Borrar la key que usa el chat | Mismo aviso ("the chat model") |
| G7 | Borrar una key sin uso | Se borra sin preguntar |
| G8 | Elegir otro modelo en el nodo huérfano y ejecutar | Corre normal |

## H. Seguridad

| # | Pasos | Esperado |
|---|---|---|
| H1 | Con la app **cerrada**: `grep -r "<últimos 8 caracteres de la key>" ~/.hiveai/` | **0 coincidencias**, ni en `settings.json`, ni en `secrets.enc`, ni en la base de datos |
| H2 | `ls -l ~/.hiveai/config/` | `.master.key` y `secrets.enc` con permisos `-rw-------` |
| H3 | `cat ~/.hiveai/config/settings.json` | Solo `model`, `modelProvider`, `modelKeyId` (un id), `currentMode`, etc. Ninguna key |
| H4 | Revisar la consola del backend tras varias pruebas | No aparece ninguna key en los logs |
| H5 | Reemplazar una key y volver a hacer el `grep` con el valor viejo | 0 coincidencias del valor anterior |

## I. Regresión con modelos locales

| # | Pasos | Esperado |
|---|---|---|
| I1 | Chat con un modelo local, modos y plugins | Igual que antes |
| I2 | "Manage Models" (modal de modelos locales) | Lista, detalles y cambio de modelo funcionan |
| I3 | Ejecución solo con nodos locales | Corre igual |
| I4 | Ejecutar sin ninguna key cargada | Todo local funciona. El menú muestra solo "Local" |

## K. Exportar / importar flujos

Formato en `docs/flow-format.md`. Se necesitan dos instalaciones (o dos `dataDir`).

| # | Pasos | Esperado |
|---|---|---|
| K1 | Instalación A: crear una ejecución con un plugin externo importado, menú de la ejecución → Export | Se guarda `<nombre>.hiveai-flow.json` en Descargas. No contiene `keyId` ni keys |
| K2 | Instalación B (sin el plugin): botón de subir en el sidebar → elegir el archivo | El diálogo lista el plugin incluido con checkbox "Install" |
| K3 | Confirmar el import con el plugin tildado | Se crea la ejecución, el plugin queda instalado y la ejecución corre |
| K4 | B con un plugin local modificado del mismo nombre: importar | Dice "your local version will be used"; el plugin local no cambia |
| K5 | Importar un flujo que usa un plugin interno no instalado | Avisa los faltantes, se importa como borrador y Run falla con 422 listando el plugin |
| K6 | Importar un archivo con texto cortado/corrupto | Mensaje "corrupted or is not valid JSON"; no se crea nada |
| K7 | Editar `formatVersion` a 99 e importar | Mensaje "Unsupported format version 99…" |
| K8 | Importar de nuevo el mismo archivo | Pide elegir copia o reemplazar; Cancelar no cambia nada; Reemplazar pide segunda confirmación |
| K9 | Pegar `sk-…` en un systemPrompt y exportar | `confirm` de advertencia antes de guardar; en el import, aviso de campos sospechosos |

## L. Reducción de tokens (cloud)

Mecanismos: caching de Anthropic, compactación de resultados viejos, resumen del historial, thinking solo al inicio del turno, tope de reenvío, guarda de tools repetidas, modelo chico para nombrar/aclarar, system prompt y descripciones más cortos.

### L0. Preparación

| | |
|---|---|
| Dónde ver el consumo | Panel de uso del chat (muestra `cache read` / `cache write` por mensaje) o la base: `sqlite3 <dataDir>/hiveai.db "select datetime(created_at/1000,'unixepoch') t, model, input_tokens in_t, output_tokens out_t, cache_read_tokens cr, cache_write_tokens cw, reasoning_tokens th from model_usage order by id desc limit 15;"` (`dataDir` está en tu config de HiveAI) |
| Modelo para caching | Usá `claude-sonnet-5-5`. Haiku exige un prefijo cacheable más grande (miles de tokens) y puede no cachear: si ves `cw`/`cr` en 0 con Haiku no es falla. Mantené los prompts cortos |
| Apagar todo para comparar | En `backend/main.ts`, debajo de `setUsageRecorder(...)`, agregá `setTokenSavingsDefaults(false);` (y el import desde `core/ai/token-savings/index.ts`). Reiniciá `deno task dev`. **Sacá la línea al terminar** |
| Plugins | Activá `web_read` y `file_read` en el menú de plugins. `counter` y `current_datetime` ahora arrancan apagados en instalaciones nuevas |
| Archivo de prueba | Creá `~/prueba-largo.txt` con ~30.000 caracteres (por ejemplo `yes "Linea de relleno numero uno con texto de ejemplo." \| head -n 600 > ~/prueba-largo.txt`) |

### L1. Prompt caching (Anthropic)

| # | Pasos | Esperado |
|---|---|---|
| L1.1 | Chat nuevo con Sonnet. Mensaje: `Leé el archivo ~/prueba-largo.txt y decime cuántas líneas tiene` | Usa `file_read`/`run_shell`. En la base, la primera fila del turno tiene `cw` > 0 |
| L1.2 | Mismo chat, mandá dentro de los 5 minutos: `¿y cuál es la primera línea?` | Filas nuevas con `cr` > 0 (lee el prefijo del system prompt y las tools desde caché) y `in_t` menor que en L1.1 |
| L1.3 | Repetí L1.1 y L1.2 con `setTokenSavingsDefaults(false)` (ver L0) | `cw` y `cr` quedan en 0 o vacíos, y `in_t` es mayor. Esta es la comparación con y sin mecanismo |
| L1.4 | Gemini flash, misma pregunta de L1.1 | Responde bien, sin errores en consola. No hay `cache_control` (Gemini cachea solo, implícito) |
| L1.5 | Modelo local, misma pregunta | Igual que antes; los mecanismos no se aplican a locales |

### L2. Thinking solo al inicio del turno (chat con Sonnet)

| # | Pasos | Esperado |
|---|---|---|
| L2.1 | `Buscá en la web quién ganó el último Mundial de fútbol y leé una de las páginas para confirmar` (necesita 2-3 llamadas a tools) | En la consola, la primera línea `[SCOUT - Agent] Model ..., options:` muestra `{ think: true }` y las siguientes (después de resultados de tools) `{ think: false }`. El chat responde sin error 400 |
| L2.2 | Mirá `th` (reasoning_tokens) en la base para ese turno | Solo la primera fila tiene `th` > 0; las de seguimiento tienen 0 o vacío |
| L2.3 | Repetí con `setTokenSavingsDefaults(false)` | Todas las iteraciones muestran `think: true` |

### L3. Compactación de resultados viejos

| # | Pasos | Esperado |
|---|---|---|
| L3.1 | Con Sonnet: `Leé estos 5 archivos grandes, uno por vez, y al final decime cuál tiene más líneas: ~/prueba-largo.txt, ~/prueba-largo.txt, ...` (usá 5 archivos distintos de más de 30.000 caracteres; si no tenés, copiá el archivo con otros nombres) | Termina y responde bien. En la base, `in_t` de las últimas iteraciones crece menos que linealmente (los primeros resultados se reemplazan por `[Tool result omitted to save tokens ...]`) |
| L3.2 | Pedile: `repetí el contenido de la primera línea del primer archivo` | Si ya fue omitido, vuelve a llamar a la tool (el marcador lo permite) y responde correctamente. No debe inventar |
| L3.3 | Repetí con `setTokenSavingsDefaults(false)` | `in_t` crece lineal; el resultado final es el mismo |

### L4. Resumen del historial (conversaciones largas)

| # | Pasos | Esperado |
|---|---|---|
| L4.1 | Para no escribir 160.000 caracteres, bajá los umbrales en `main.ts`: `setTokenSavingsDefaults({ summaryTriggerChars: 6000, summaryMinHistoryChars: 2000 });` y reiniciá. Con Sonnet mandá `Mi perro se llama Bruno`, después 4 mensajes de ~1.500 caracteres cada uno (texto de relleno) y uno corto más | Al llegar al umbral aparece "Compactando el contexto de la conversación..." en el indicador del chat. En la base hay una fila extra con un modelo Haiku del mismo proveedor y el mismo grupo de uso |
| L4.2 | Después preguntá: `¿Cómo se llama mi perro?` | Responde Bruno (el resumen conserva el dato) |
| L4.3 | Con los mismos umbrales bajos, usá una key de Gemini o Anthropic sin acceso al modelo chico (o desconectá la red justo antes de enviar el mensaje largo) | El chat no se rompe: sale un warning `[token-savings] summary failed` y responde con el historial completo |
| L4.4 | Recargá el chat | Se ven todos los mensajes originales completos: la compactación solo cambia lo que se envía al modelo, no lo guardado |

### L5. Ejecuciones

| # | Pasos | Esperado |
|---|---|---|
| L5.1 | Generá un flujo desde un prompt: `Leé https://example.com y guardá un resumen de dos líneas`. Dejalo con modelo cloud | Se genera. El nombre de la ejecución sale con un modelo chico (fila en la base con `claude-haiku...` o `gemini-...flash...` y rol del orquestador) |
| L5.2 | Ejecutalo | Termina bien. Filas de uso con `context_kind = execution` |
| L5.3 | Nodo LLM con `web_read` y un system prompt `Llamá web_read con https://example.com tres veces seguidas con los mismos argumentos y después respondé` | En consola: `Refusing to repeat identical call to 'web_read'`. La tool se ejecuta una sola vez y el nodo responde |
| L5.4 | Mismo caso con `setTokenSavingsDefaults(false)` | La tool se ejecuta las tres veces |
| L5.5 | Una ejecución que ya tenías antes de estos cambios | Da el mismo resultado esperado |

### L6. System prompt y tools más cortos

| # | Pasos | Esperado |
|---|---|---|
| L6.1 | Con Sonnet, preguntá `¿Estás corriendo en un modelo local o en la nube?` | Ya no afirma que corre localmente y que nada sale del dispositivo. Con un modelo local el prompt es el de siempre |
| L6.2 | Comparar `in_t` del primer mensaje (`Respondé solo: hola`) antes y después (con `setTokenSavingsDefaults(false)` solo se apagan los mecanismos, no el prompt corto; para comparar el prompt viejo usá `git stash` o la rama `main`) | Unos 1.000-1.500 tokens menos de entrada |
| L6.3 | Probá una consulta por cada tool: web (`buscá las novedades de Deno 2`), archivo (`dónde está la carpeta Documents`), shell (`corré df -h`), `ask_user` (`Borrá el archivo informe` sin decir cuál) | Cada tool se elige bien, y `ask_user` abre la pregunta en el chat. **Esto reemplaza las evals: si alguna tool deja de elegirse, reportalo con el prompt exacto** |
| L6.4 | Menú de plugins en una instalación nueva (o borrando el estado de `counter` y `current_datetime` en la tabla de plugins) | Arrancan apagados; si los activás a mano y reiniciás, siguen activos |

### L7. Historial del chat recortado

| # | Pasos | Esperado |
|---|---|---|
| L7.1 | Pedile a Sonnet `Escribí un texto de unas 2.000 palabras sobre el mar`, seguilo con 5 mensajes cortos, y después preguntá `¿Qué dijiste al principio de tu primer texto?` | Responde con lo que pueda ver del inicio (se conserva el comienzo) sin errores. En el chat guardado el texto original sigue completo |

### L8. Gemini cache explícito (apagado por defecto)

| # | Pasos | Esperado |
|---|---|---|
| L8.1 | En `main.ts` agregá `setTokenSavingsDefaults({ geminiContextCache: true });`, reiniciá, y en un chat con Gemini flash mandá dos mensajes seguidos que usen una tool | Ambos responden bien. En la consola no debe aparecer `gemini cached request failed`. En la base, `cr` > 0 en el segundo |
| L8.2 | Si aparece ese warning | Anotá el mensaje completo; significa que la API no aceptó el caché y se cayó a la request normal. Dejalo apagado y reportámelo |

## Qué reportarme si algo falla (sección L)
Prompt exacto, modelo, las últimas filas de `model_usage` (query de L0) y las líneas `[token-savings]` o `[SCOUT - Agent]` de la consola.

## J. Automáticos

Desde `backend/`: `deno test -A` → **480 tests deben pasar**. Desde `frontend/`: `npx tsc --noEmit -p tsconfig.app.json` y `npm run build` sin errores.

## Qué reportarme si algo falla
- El texto del toast o del mensaje.
- El proveedor, el modelo y la key (alias) usada.
- Las líneas de la consola con `[SCOUT - Agent]`, `[Compiler Native LLM]` o `[Visual Builder - Generator]`.
- Los casos más probables de fallar: B2 (listado dinámico), D1 y D3 (thinking de Claude), F2 y F3 (propuesta de modelo de HiveQueen), y F11 (error de proveedor dentro de un nodo).

**Gasto estimado:** menos de US$0,10 por proveedor si respetás los prompts cortos y usás Sonnet solo en D1.
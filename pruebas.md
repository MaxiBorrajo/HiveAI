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

## J. Automáticos

Desde `backend/`: `deno test -A` → **480 tests deben pasar**. Desde `frontend/`: `npx tsc --noEmit -p tsconfig.app.json` y `npm run build` sin errores.

## Qué reportarme si algo falla
- El texto del toast o del mensaje.
- El proveedor, el modelo y la key (alias) usada.
- Las líneas de la consola con `[SCOUT - Agent]`, `[Compiler Native LLM]` o `[Visual Builder - Generator]`.
- Los casos más probables de fallar: B2 (listado dinámico), D1 y D3 (thinking de Claude), F2 y F3 (propuesta de modelo de HiveQueen), y F11 (error de proveedor dentro de un nodo).

**Gasto estimado:** menos de US$0,10 por proveedor si respetás los prompts cortos y usás Sonnet solo en D1.
# Spike: rendimiento de Ollama en hardware local sin GPU

## Problema

Con un modelo local en CPU, la primera respuesta tardaba demasiado: ~65 s hasta el primer token con la configuración que HiveAI traía por defecto.

## Qué se probó

Se variaron los parámetros que Ollama expone y que HiveAI controla, primero en un benchmark controlado y después en la app real:

| Parámetro | Dónde se aplica | Qué hace |
|---|---|---|
| `kv_cache_type` (`f16` / `q8_0` / `q4_0`) | Variable de entorno `OLLAMA_KV_CACHE_TYPE` del servidor | Precisión del caché de claves/valores de atención |
| `flash_attention` | Variable de entorno `OLLAMA_FLASH_ATTENTION` del servidor | Implementación de atención más rápida y con menos memoria; requisito para cuantizar el KV |
| `keep_alive` | Por request | Cuánto queda el modelo cargado tras el último mensaje |
| `n_ctx`, `n_batch`, `mmap`, `mlock` | Por request | Contexto, tamaño de lote del prefill y manejo de memoria |

## Resultados

- **Benchmark controlado (CPU):** el KV cuantizado (`q4_0` / `q8_0`) **duplicaba el tiempo de prefill** frente a `f16`. Cuantizar ahorra memoria pero en CPU cuesta velocidad.
- **En la app:** el tiempo hasta el primer token bajó de **~65 s (`q8_0`) a ~34 s (`f16` + flash attention)**, y la velocidad de generación subió **~8 %**.
- **Tiempo total de la respuesta:** casi no cambió, porque lo domina el razonamiento (thinking) del modelo, no el prefill.

## Conclusiones

1. En CPU conviene `f16` + flash attention; cuantizar el KV solo tiene sentido para ahorrar memoria.
2. `keep_alive` de 30 min evita pagar la carga del modelo en cada mensaje.
3. El mayor costo restante es el razonamiento. Por eso se agregó el ajuste `thinking`, que permite apagarlo para obtener respuestas mucho más rápidas a cambio de calidad en tareas difíciles.

## Decisión de producto

Se eliminaron los modos (`light`, `full`, `custom`, `default`). Había dos problemas: los modos `light` y `full` empujaban a valores peores para CPU (KV cuantizado), y cambiar de modelo reseteaba el modo y reiniciaba Ollama. Ahora hay **una única lista de ajustes** con estos valores por defecto, que se aplican siempre salvo que el usuario los cambie a mano:

| Ajuste | Valor por defecto |
|---|---|
| `thinking` | activado |
| `kv_cache_type` | `f16` |
| `flash_attention` | activado |
| `n_ctx` | 4096 |
| `n_batch` | 512 |
| `mmap` | activado |
| `mlock` | desactivado |
| `keep_alive` | `30m` |
| `temperature` / `top_k` / `top_p` / `repeat_penalty` | 0.7 / 40 / 0.9 / 1.1 |
| `limit_output` | activado |
| `n_gpu_layers` / `n_threads` | automático (decide Ollama) |

### Implementación

- Backend: módulo `backend/modules/model-settings`. Los valores por defecto viven en el código (`lib/definitions.ts`); en `<configDir>/model-settings.json` se persisten **solo** los valores que el usuario modificó, así un cambio de default en una versión nueva le llega a quien nunca lo tocó.
- API: `GET /api/model-settings` y `PUT /api/model-settings` (`{ "values": { "<ajuste>": valor } }`).
- Los ajustes del servidor (`kv_cache_type`, `flash_attention`) reinician Ollama solo si difieren de lo activo; el resto se aplica por request.
- `thinking` se pasa como `think` a los nodos locales de Scout y Sader. En Sader el nodo Responder siempre usa `think: false` (genera una respuesta corta). No aplica a modelos cloud.
- Frontend: el menú de ajustes reemplaza al selector de modos, con las secciones "Per request" y "Ollama server (restarts Ollama)".

### Limitaciones conocidas

- Los valores por defecto del servidor (`f16` + flash attention) no se aplican en silencio, porque reiniciar el servicio pide contraseña de administrador. Al arrancar, si el servidor no los tiene activos, un modal pide confirmación ("Apply and restart" / "Not now"). "Not now" no vuelve a preguntar; se pueden aplicar después desde Settings.
- Los hints automáticos de `mmap`/`mlock` según la RAM libre se descartaron: quedan en `true`/`false` fijos.
- Un `~/.hiveai/config/modes.config.json` previo queda sin uso y se ignora.

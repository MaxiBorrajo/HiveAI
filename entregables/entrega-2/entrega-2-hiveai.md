# Entrega 2 - HiveAI (Sprint 3, 5 Oct - 24 Oct)

> **Objetivo del sprint:** que el modelo grande (cloud) pueda orquestar mientras modelos chicos o locales ejecutan, y que el usuario pueda **medir** cuánto consume cada cosa. Se suman archivos como entrada y salida, y se mejora el rendimiento del modelo local en equipos modestos.

---

## Resumen Ejecutivo

### Qué se agregó/modificó en esta iteración

HiveAI pasó de usar solo modelos locales (Ollama) a poder **mezclar modelos locales y cloud** en el chat y en cada nodo de una ejecución, con registro y comparación del consumo.

- **Modelos cloud (Anthropic y Google)**: gestión de API keys con alias (varias por proveedor), validación contra el proveedor, almacenamiento cifrado y selector de modelos agrupado por key. Cada nodo de IA de una ejecución puede usar un modelo y una key distintos; HiveQueen propone el modelo por nodo.
- **Factoría única de modelos** (`create-chat-model.ts` + adaptadores por proveedor): resuelve las particularidades de cada proveedor (thinking, límites de salida, opciones de Ollama que no aplican a cloud).
- **Registro de uso** de cada llamada a un modelo (tokens, tiempos, modelo, key, estado), capturado en un único callback de la factoría. Sin precios ni costos.
- **Consumo visible**: por respuesta y por conversación en el chat; por corrida, nodo y modelo en el historial de ejecuciones; y **comparación de dos corridas lado a lado**.
- **Verificación de soporte de tools** al elegir un modelo (chat y nodos), locales y cloud.
- **Streaming en nodos LLM y Agente** con timeout por inactividad, para respuestas largas.
- **Archivos**: adjuntos en el chat y archivos de entrada en las ejecuciones, guardados por chat y por corrida.
- **Configuración por plugin**: un plugin declara los datos que necesita (por ejemplo una API key) y el usuario los carga desde la app.
- **Preguntas aclaratorias** del agente cuando falta información, en el chat y al generar ejecuciones.
- **Rendimiento del modelo local**: ajustes de Ollama (flash attention, KV cache, keep_alive, batch, thinking) reemplazan a los Modos.
- **Evals offline** extendidos (chat, generador de grafos y ejecuciones) con reporte comparable.

### Decisiones tomadas

#### Los Modos (light / full / custom) se eliminaron por una lista única de ajustes
Surgió del spike de rendimiento (`entregables/spike/ollama-rendimiento-local.md`). En CPU, cuantizar el KV cache **duplicaba** el prefill, y los modos `light` y `full` empujaban justamente a esos valores. Con `f16` + flash attention el tiempo hasta el primer token bajó de ~65 s a ~34 s y la generación subió ~8 %. Además, cambiar de modelo reseteaba el modo y reiniciaba Ollama. Ahora hay un único conjunto de ajustes con buenos defaults; solo se persisten los que el usuario toca. Esto **reemplaza la US1 de la PoC** y por eso la historia de hardware modesto de este sprint se ajustó para hablar de "ajustes" y no de "Modos".

#### Registro de uso centralizado en la factoría
En vez de medir en cada nodo, se adjunta un callback al modelo al crearlo, así ninguna llamada queda sin registrar. Un test de guarda (`model-factory-guard.test.ts`) falla si algún archivo instancia un `ChatOllama`/`ChatAnthropic`/etc. fuera de la factoría. Si el proveedor no informa un dato se guarda vacío; nunca se completa con 0.

#### Secretos cifrados localmente, no en el almacén del SO
Las keys se guardan en `secrets.enc` (AES-GCM) con una master key local con permisos `0600`. Se eligió porque funciona igual en Linux y Windows sin depender de un servicio del sistema. El alias de la key se copia en cada registro de uso, así borrar una key no borra el historial.

#### Streaming con timeout por inactividad
El timeout total de la request cortaba respuestas largas aunque siguieran avanzando. Se pasó a un timeout de inactividad (240 s sin recibir tokens). Si el stream se interrumpe, el nodo conserva el texto parcial y devuelve un `StreamInterruptedError`.

#### No se evalúa la calidad en la comparación de corridas
La app muestra resultados, tokens y latencia lado a lado y deja que el usuario juzgue. La evaluación automática es responsabilidad de las evals.

### Desafíos técnicos encontrados
- Que cada proveedor tenga sus particularidades (Claude rechaza `thinking` en algunos modelos y se reintenta sin él; Gemini y Anthropic manejan distinto el límite de salida) sin ensuciar los nodos.
- Saber si un modelo cloud soporta tools sin una lista fija: se consulta lo que el proveedor expone de cada modelo.
- Mantener consistente la configuración de modelos por nodo cuando una key se borra: la ejecución no arranca y explica qué nodo falló, pero el historial queda intacto.
- Rendimiento del modelo local en CPU: el costo dominante pasó a ser el razonamiento (thinking), por lo que se agregó un toggle.
- Streaming y tool calls en el nodo Agente: el ciclo debe continuar después de cada herramienta.

---

# User Stories

## US-A - Guardar API keys de proveedores cloud y usar sus modelos en chat y ejecuciones

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero guardar mis API keys de proveedores cloud y usar sus modelos en el chat y en las ejecuciones, para que el modelo grande orqueste y los chicos ejecuten sin editar configuración a mano.

### Valor aportado
Habilita el modelo cloud como orquestador, permite armar un mix de modelos sin salir de la app y separa el consumo por key. Es el mecanismo central del diferencial.

### Criterios de aceptación
- Se puede agregar una key indicando proveedor y alias (por ejemplo "Claude – personal"), y tener varias keys por proveedor
- Se puede editar el alias, reemplazar el valor de la key y eliminarla
- La key se guarda cifrada localmente y nunca en texto plano en `settings.json`; la interfaz solo la muestra enmascarada
- Al agregar o editar una key se valida con una llamada mínima al proveedor y se informa si es inválida
- Una vez cargada, los modelos de ese proveedor aparecen junto a los locales, en el selector del chat y en el de cada nodo de IA, agrupados por key
- Para un modelo cloud el usuario elige con qué key (alias) se usa
- El chat funciona de punta a punta (streaming, herramientas, thinking si el modelo lo expone) con un modelo cloud
- Cada nodo de IA puede usar un modelo local o cloud distinto; la configuración queda guardada con la versión del grafo
- HiveQueen propone el modelo por nodo y el usuario puede cambiarlo
- Las opciones propias de Ollama no se aplican a modelos cloud
- Un error de proveedor (key inválida, límite, red) se muestra de forma clara sin romper el chat ni la ejecución
- Eliminar una key en uso lo advierte y no rompe el historial de uso; una ejecución con un modelo o key que ya no existe no arranca y explica el motivo

### DoD
Pantalla de gestión de keys; almacenamiento cifrado verificado (la key no aparece en claro en ningún archivo del directorio de configuración); validación implementada; factoría única proveedor + modelo + opciones usada en todos los sitios que antes instanciaban `ChatOllama` (garantizado por test de guarda); chat probado con un modelo local y uno cloud; ejecución de punta a punta con un mix cloud + local; probado con dos keys del mismo proveedor. Los casos de prueba manuales están en `pruebas.md`.

---

## US-B - Verificar que el modelo elegido soporta tool calling

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero que HiveAI verifique que el modelo elegido, en el chat y en cada nodo de una ejecución, soporta tool calling, para no descubrirlo cuando falla.

### Valor aportado
Evita configurar un modelo que no sirve para el caso de uso principal.

### Criterios de aceptación
- Al seleccionar un modelo se consulta si soporta tools: en locales por la API de Ollama, en cloud por la información que expone el proveedor de cada modelo (no por una lista fija)
- Los modelos cloud que no sirven para chat con herramientas (audio, imagen, embeddings, etc.) no son seleccionables o se muestran deshabilitados con el motivo
- Un modelo sin soporte no puede quedar como modelo activo ni asignarse a un nodo, y la interfaz explica por qué
- Si el proveedor no informa el soporte (estado "desconocido") se permite con una advertencia visible
- Los fallos de tools en tiempo de ejecución llegan como un mensaje claro, no como una excepción sin manejar

### DoD
Verificación integrada en la selección del chat y del nodo; probada con un local que soporta tools y uno que no (por ejemplo gemma3), y con un cloud de chat y uno que no es de chat.

> **DoD ajustado:** se quitaron del alcance la verificación **al arrancar una ejecución** con nodos ya configurados y el aviso **al abrir la app** cuando el modelo guardado dejó de cumplir. Hoy la verificación ocurre solo en la selección (`set-models.ts`). Quedan para el próximo sprint.

---

## US-C - Registrar el uso de cada llamada al modelo

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero que HiveAI registre el uso de cada llamada al modelo (tokens, tiempos y contexto), para poder medir cuánto consume cada cosa y qué parte absorben los modelos locales.

### Valor aportado
Es la base de toda la comparación. No se calculan precios: solo se registra uso real.

### Criterios de aceptación
- Cada llamada (chat, ejecuciones, generación de grafos, verificadores) registra:
  - **Contexto:** chat (conversación y mensaje), ejecución (ejecución, corrida, nodo) o generación de grafo
  - **Modelo:** proveedor, modelo, ubicación (local o cloud) y rol (orquestador o delegado)
  - **Key:** alias usado, copiado al momento de la llamada
  - **Tokens:** entrada, salida, cacheados (lectura y escritura) y de razonamiento
  - **Tiempos:** duración total y tiempo hasta el primer token
  - **Fecha y estado** (ok o error, con el tipo de error)
- El formato es el mismo para locales y cloud
- Si el proveedor no informa un dato se guarda vacío; nunca se inventa ni se completa con 0
- El registro persiste entre sesiones y no depende de que la pantalla esté abierta
- Eliminar una key no borra el historial: el alias queda congelado en cada registro
- Las llamadas que fallan se registran con estado de error
- Las llamadas de un mismo mensaje o de una misma corrida se pueden agrupar
- No se calculan precios ni costos

### DoD
Tabla de uso con migración (`model_usage`); captura centralizada con un callback en la factoría; test de guarda que verifica que ningún modelo se instancia fuera de la factoría; endpoint de lectura `GET /api/usage` con filtros (contexto, corrida, modelo, key, fechas); probado con chat y ejecución en un modelo local y uno cloud.

---

## US-D - Ver el consumo de cada respuesta del chat y de la conversación

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero ver cuántos tokens, qué velocidad y cuánto tiempo consumió cada respuesta del chat y la conversación completa, para entender qué me cuesta una conversación y cómo rinde cada modelo.

### Valor aportado
Hace visible el consumo de cada conversación.

### Criterios de aceptación
- Por respuesta: tokens de entrada y salida (sumando las llamadas internas del mensaje: iteraciones del agente, herramientas, verificadores), tokens por segundo de generación, tiempo hasta el primer token, latencia total y modelo(s) usado(s) marcados como local o cloud
- Por conversación: totales por modelo, con subtotal cloud y subtotal local separados, sin una cifra única mezclada como valor principal
- Los tokens por segundo se calculan sobre el tiempo de generación, sin la espera de herramientas; si falta el dato se muestra "—"
- Los tokens cacheados se muestran cuando existen
- Los mensajes anteriores a la funcionalidad muestran "—", no ceros

### DoD
Vista de consumo en el chat, verificada con una conversación que combina un modelo local y uno cloud (cambio de modelo a mitad).

---

## US-E - Ver el consumo de cada corrida de una ejecución

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero ver el consumo de cada corrida de una ejecución, desglosado por nodo y por modelo, para entender dónde gasta un mix de modelos locales y cloud.

### Valor aportado
Con la misma suscripción se hace más, porque el modelo grande solo orquesta. Permite optimizar qué nodo delegar a un modelo más chico.

### Criterios de aceptación
- Por corrida: resultado, total de tokens, latencia total y desglose por nodo y por modelo
- Cada corrida conserva la configuración de modelos por nodo con la que se ejecutó, aunque el grafo cambie después
- El desglose distingue modelos grandes de modelos chicos o locales
- Se muestra con qué key (alias) se hizo cada llamada cloud, para contrastarlo con el gasto que informa la consola del proveedor
- El historial de corridas conserva su consumo

### DoD
Vista de consumo en el historial de ejecuciones, probada con el caso demo: la misma ejecución ("armar una página web") corrida en todo cloud y en mix, con dos API keys distintas, mostrando tokens, latencia y resultado de ambas.

---

## US-F - Comparar dos corridas de una misma ejecución

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero abrir dos corridas de una misma ejecución y contrastarlas lado a lado (resultado, configuración de modelos, tokens y latencia), para ver si un mix local + cloud llega a un resultado similar gastando menos del modelo grande.

### Valor aportado
Convierte el consumo en una decisión concreta: permite ver cuánto del trabajo absorbió el modelo chico sin perder el resultado que busco.

### Criterios de aceptación
- Se pueden elegir dos corridas del historial de una misma ejecución
- Se muestran lado a lado: resultado (texto y archivos generados), configuración por nodo (modelo, local o cloud, alias de key), tokens por modelo (entrada, salida, cacheados) y latencia total y por nodo
- Se resaltan las diferencias: nodos cuyo modelo cambió y variación de tokens por modelo
- Se destaca la métrica principal: tokens del modelo orquestador cloud en cada corrida y tokens delegados
- La comparación directa de tokens solo se hace cuando el mismo modelo aparece en ambas corridas; si difieren, se muestran lado a lado sin sumarlos en una cifra única y con un aviso de que no son precios
- La app no evalúa la calidad del resultado: la juzga el usuario

### DoD
Probada con el caso demo: la misma ejecución ("armar una página web") corrida en todo cloud y en mix, con dos API keys distintas, mostrando tokens, latencia y resultado de ambas.

---

## US-G - Streaming en los nodos LLM y Agente

### Actor/es
- Usuario de HiveAI (quien arma y ejecuta flujos con nodos LLM y Agente)

### Funcionalidad
Como usuario quiero que los nodos LLM y Agente reciban la respuesta del modelo por streaming, para que el modelo pueda generar textos más largos sin cortarse y yo aproveche toda su capacidad de respuesta.

### Valor aportado
Las respuestas largas dejan de fallar por timeout o por esperar la respuesta completa.

### Criterios de aceptación
- Los nodos LLM y Agente consumen la respuesta como stream de tokens y no como una única respuesta bloqueante
- El texto parcial se acumula en el nodo y los nodos siguientes reciben el resultado completo al terminar el stream; los flujos existentes no cambian su comportamiento
- Un timeout de inactividad (tiempo máximo sin recibir tokens) reemplaza al timeout total de la request: una respuesta larga que sigue avanzando no se corta
- El límite de tokens de salida es configurable por nodo (campo "Max output tokens")
- Si el stream se interrumpe (red, cancelación o modelo caído), el nodo conserva el texto parcial y devuelve un error claro (`StreamInterruptedError`)
- En el nodo Agente el streaming convive con las tool calls: se detectan y ejecutan y el ciclo continúa tras cada una
- Funciona con modelos locales y cloud, con las particularidades de cada proveedor resueltas en la factoría
- Se puede cancelar una ejecución en curso y el stream se cierra liberando la conexión

### DoD
Streaming implementado en ambos nodos (`stream-model.ts`, `llm-executor.ts`); pruebas unitarias de stream completo, interrupción, cancelación y tool calls (`stream-model.test.ts`, `llm-executor.test.ts`); verificado con una respuesta larga que antes se cortaba.

> **DoD ajustado:** se quitaron del alcance (a) mostrar en la interfaz el **máximo de tokens de salida de cada modelo** (hoy el campo es libre) y (b) reflejar el **texto parcial en vivo** en el feed de actividad de las ejecuciones. El hook `onToken` existe en el streaming pero todavía no está conectado a la interfaz de ejecuciones. La documentación de límites quedó en este documento y no junto a los del spike.

---

## US-H - Archivos adjuntos en el chat

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero adjuntar archivos al chat y conservar los archivos enviados y creados en cada chat, para que el modelo trabaje con mis documentos y no los pierda.

### Valor aportado
Permite usar la IA sobre material propio en lugar de pegar texto a mano, y deja a mano lo que se envió y lo que la IA generó.

### Criterios de aceptación
- Se pueden adjuntar uno o más archivos al enviar un mensaje (texto plano, Markdown, PDF; imágenes solo si el modelo las soporta)
- Se define y muestra un tope de tamaño; un archivo no soportado o demasiado grande se rechaza con un mensaje claro
- El contenido llega al modelo dentro del contexto; si no entra se informa en lugar de truncarlo en silencio
- Los archivos enviados y los que la IA crea durante el chat se guardan asociados a ese chat
- El chat muestra la lista de sus archivos (enviados y creados) y permite abrirlos o descargarlos
- Los adjuntos quedan asociados al mensaje y se ven al reabrir el chat
- Eliminar un chat elimina sus archivos

### DoD
Botón de adjuntar en `ChatInput`; almacenamiento por chat (`core/attachments`); vista de archivos del chat (`AttachmentsList`); extracción de texto de PDF; probado con un archivo corto, uno que excede el contexto y un archivo creado por la IA.

---

## US-I - Archivos como entrada y salida de una ejecución

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero usar archivos como entrada de una ejecución y conservar los archivos de entrada y los creados en cada corrida, para procesar documentos con tareas específicas.

### Valor aportado
Lleva las ejecuciones a casos reales con documentos y deja guardado qué entró y qué salió de cada corrida.

### Criterios de aceptación
- Una ejecución puede recibir uno o más archivos como entrada al correrse
- Se aplican los mismos tipos y topes que en US-H
- Los archivos de entrada y los que la ejecución crea se guardan asociados a esa ejecución y a la corrida que los produjo
- Se pueden ver y descargar desde el historial de la ejecución
- Eliminar una ejecución elimina sus archivos

### DoD
Entrada de archivo en una ejecución de ejemplo; archivos de entrada y salida visibles por corrida; verificado de punta a punta.

---

## US-J - Que la IA pregunte cuando le falta información

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero que la IA me haga preguntas cuando le falte información, para mejorar sus resultados.

### Valor aportado
Menos respuestas equivocadas por suposiciones.

### Criterios de aceptación
- Cuando una petición es ambigua o falta un dato necesario, el agente pregunta antes de actuar (herramienta `ask_user`)
- No pregunta cuando puede razonablemente asumir un valor por defecto o resolverlo con una herramienta
- Funciona en el chat y en la generación de ejecuciones (aclaración y revisión del plan, con panel de respuesta inline)

### DoD
Comportamiento implementado en chat y generación; cubierto por un caso de ambigüedad en el eval del generador de grafos y probado a mano.

> **DoD ajustado:** el criterio original pedía medir "menos errores sin aumentar de forma notable el número de preguntas" con casos ambiguos en el eval. Hoy el eval tiene un único caso estructuralmente ambiguo y no hay una comparación antes/después, por lo que esa medición **no se hizo** y queda para el próximo sprint.

---

## US-K - Pasarle datos a un plugin como variable de entorno

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero que, si un plugin necesita información (por ejemplo una API key), pueda pasársela desde la app y que se guarde como variable de entorno de ese plugin, para poder usar plugins que requieren credenciales o configuración sin tocar archivos.

### Valor aportado
Los plugins externos que necesitan credenciales se vuelven utilizables desde la interfaz, y los datos sensibles no quedan en texto plano.

### Criterios de aceptación
- Un plugin puede declarar los campos de configuración que necesita (`configFields`)
- El usuario puede cargar, reemplazar y eliminar el valor de cada campo desde la interfaz
- Solo se aceptan campos que el plugin declaró; un valor vacío se rechaza
- El valor se guarda cifrado (mismo almacén de secretos que las API keys) y la interfaz muestra solo los últimos 4 caracteres
- Al cambiar un valor el plugin externo se reinicia para recibirlo como variable de entorno
- El valor no aparece en los logs ni en texto plano en disco

### DoD
Módulo `plugin-config` con guardar, leer y eliminar; campos dinámicos en la interfaz del plugin; pruebas unitarias del módulo (`tests/unit/modules/plugin-config`).

---

## US-L - Modelos locales más rápidos en hardware modesto

### Actor/es
- Usuario de HiveAI con hardware limitado

### Funcionalidad
Como usuario con hardware modesto quiero que los modelos locales respondan más rápido, para que usar la app sea fluido.

### Valor aportado
Hace usable el modelo local en equipos limitados.

### Criterios de aceptación
- Flash attention, cuantización de KV cache, `keep_alive`, tamaño de batch y `thinking` se configuran desde los **ajustes del modelo** (que reemplazan a los Modos)
- La interfaz distingue qué se aplica por request (`keep_alive`, batch) y qué es del servidor de Ollama (flash attention, KV cache) y por lo tanto requiere reiniciarlo ("Per request" / "Ollama server (restarts Ollama)")
- Los defaults son los que dieron mejor resultado en CPU (`f16` + flash attention, `keep_alive` de 30 min) y se aplican siempre salvo que el usuario los cambie
- La mejora se midió con el registro de uso (tokens por segundo y tiempo hasta primer token), antes y después, en un equipo sin GPU: primer token de ~65 s a ~34 s y generación ~8 % más rápida
- Los parámetros de Ollama no se aplican a modelos cloud

### DoD
Configuración aplicada y medida; resultados documentados en `entregables/spike/ollama-rendimiento-local.md`.

> **DoD ajustado:** el criterio original hablaba de configurarlos "desde los Modos". Los Modos se eliminaron durante el sprint por lo que el spike demostró (ver Decisiones), así que la historia se cumple con ajustes fijos.

---

## US-M - Set de evals offline con métricas

### Actor/es
- Desarrollador de HiveAI

### Funcionalidad
Como desarrollador quiero un set de evals offline con métricas, para saber si un cambio mejora o empeora el agente.

### Valor aportado
Sin métricas, "calidad similar o mejor" es una opinión.

### Criterios de aceptación
- Existe un set de casos para chat, generación de grafos y ejecuciones (69 casos: 18 de chat, 13 del generador y 38 de ejecuciones), incluidos casos de varias iteraciones y razonamiento
- Cada caso tiene criterio de éxito automático (o juez LLM donde no se puede, `judge.ts`)
- El reporte muestra por categoría tasa de acierto, latencia y tokens, y se puede comparar entre dos corridas (`deno task eval:compare`)
- Se puede correr contra un modelo local y uno cloud
- La línea base está registrada para el modelo por defecto (reportes en `backend/tests/llm-eval/results`)

### DoD
Harness de `backend/tests/llm-eval/` extendido (import corregido a `strategy/scout/graph.ts`), casos nuevos, reporte comparable, línea base registrada.

> **DoD ajustado:** (a) el set quedó en **69 casos** y no en 20 a 30, porque se agregaron suites para generador y ejecuciones; (b) **no se agregó un job de CI** que corra los tests unitarios: el único workflow es `release.yml`, que solo compila y publica. Los 480 tests unitarios se corren a mano con `deno test -A`. (c) La corrida del eval en Mac y Windows no se verificó; se probó en Linux.

---

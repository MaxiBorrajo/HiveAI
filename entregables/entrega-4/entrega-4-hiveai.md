# Entrega 4 - HiveAI (Sprint 5, 16 Nov - 5 Dic)

> **Objetivo del sprint:** pulir la experiencia diaria del chat y del editor de ejecuciones, sumar nuevas formas de entrada y salida (voz e imágenes), hacer más confiables las respuestas de los modelos locales chicos y dejar el modelo de datos normalizado de cara a la entrega final.

---

## Resumen Ejecutivo

### Qué se agregó/modificó en esta iteración

Las entregas anteriores construyeron las capacidades centrales (ejecuciones, modelos cloud, medición, evals, archivos). En este sprint el foco pasó a **cómo se usan**: hablarle al chat, ver respuestas ricas (fórmulas, diagramas, multimedia), manejar archivos con vistas previas reales, corregir un mensaje y reenviarlo, y editar muchos nodos a la vez. Además se atacaron dos problemas frecuentes de los modelos locales chicos y se normalizó la base de datos.

- **Entrada por voz**: grabar un mensaje o soltar un archivo de audio y transcribirlo en local (Whisper en el navegador), en español o inglés.
- **Respuestas más ricas en el chat**: fórmulas (KaTeX), diagramas Mermaid, dibujos SVG, resaltado de código con botón de copiar, e imágenes, video y audio embebidos.
- **Vistas previas de archivos**: miniaturas, tarjetas por tipo, visor grande con navegación, PDF en su visor, HTML en un marco aislado, y adjuntar **arrastrando o pegando** (Ctrl+V).
- **Editar y reenviar un mensaje**: bifurcar *antes* de un mensaje para corregirlo, reutilizar un mensaje en el input y copiar mensajes.
- **Edición masiva de nodos LLM**: seleccionar varios nodos (Ctrl+clic o Shift+arrastrar) y cambiarles modelo, límite de tokens y herramientas de una vez.
- **Vista legible de la configuración de un nodo** fuera del modo edición.
- **Modelos locales más confiables**: el razonamiento escrito dentro de la respuesta (`<think>…</think>`) se separa de la respuesta, se detectan los modelos que razonan aunque el thinking esté apagado, y se **cortan las respuestas que entran en un bucle de repetición**.
- **Modelo de datos normalizado**: listas y JSON guardados en columnas pasan a tablas y columnas propias, con claves foráneas reales (migraciones 0015 a 0018). El diagrama de entidades está en `entregables/entrega-final/HiveAI - Modelo de entidades.png`.
- **Correcciones**: el juez reintenta una vez cuando no respeta el formato; los nodos del grafo ya no parpadean durante una corrida; la barra de controles de corrida y la del input del chat se adaptan a pantallas angostas; la corrección de una ejecución por prompt considera todos los plugins instalados y no solo los activos en el chat.

### Decisiones tomadas

#### La transcripción de voz corre en el navegador y el texto se revisa antes de enviar
Se usa `whisper-small` con `transformers.js` en un *web worker*: no hace falta un servidor ni conexión después de la primera descarga del modelo, que queda en la caché del navegador. Se eligió `small` porque `base` se equivocaba demasiado en español. El codificador (la parte que "escucha") queda en precisión completa porque pierde mucha calidad al cuantizarse; el decodificador va en 4 bits. Usa la GPU (WebGPU) si está disponible y si no la CPU (WASM). El idioma se elige siempre de forma explícita (ES / EN): `transformers.js` no implementa la detección de idioma de Whisper y, sin indicarlo, traducía el español al inglés. El texto transcripto se agrega al input para que el usuario lo lea antes de enviarlo.


#### Los bucles de repetición se vigilan en la salida, no en el modelo
Los modelos locales chicos a veces repiten la misma palabra u oración hasta llenar el contexto, y `repeat_penalty` solo lo hace menos frecuente. Se revisa el texto a medida que llega (cada 200 caracteres): si termina en una unidad de hasta 300 caracteres repetida al menos 8 veces y que ocupa al menos 400 caracteres, se corta el stream, se conserva una sola copia y se avisa. El umbral deja pasar tablas, separadores y listas cortas.

#### Los modelos que "siempre piensan" se descubren al usarlos
Ollama solo puede *pedirle* a un modelo que no razone; algunos están entrenados para hacerlo igual y no hay forma de saberlo de antemano. Cuando un modelo razona con el thinking apagado se registra en `~/.hiveai/config/models-that-always-think.json`, se avisa la primera vez y el botón de thinking lo indica. El razonamiento escrito entre etiquetas `<think>` dentro de la respuesta se mueve al panel de razonamiento, también en los nodos de las ejecuciones.

#### Las respuestas ricas no comprometen la seguridad ni la carga de la app
Mermaid (~1 MB) se carga recién cuando aparece el primer diagrama y corre en modo estricto (sin scripts ni clics). Un `$` suelto no se interpreta como fórmula para no romper precios como "$5 y $10"; las fórmulas escritas como `\( … \)` o `\[ … \]` se normalizan. Las vistas previas de HTML corren en un `iframe` con `sandbox` que solo permite scripts. El prompt de sistema le indica al modelo qué puede renderizar y que solo use URLs reales para imágenes y multimedia.

#### Editar un mensaje es bifurcar antes de él
Siguiendo la decisión de la entrega 3 (volver atrás se hace con fork, no con "restore"), corregir un mensaje crea un chat nuevo con el historial *anterior* a ese mensaje y deja el mensaje en el input para editarlo y reenviarlo. El chat original no se toca. Un adjunto reutilizado de un mensaje anterior se duplica (archivo, fila e índice de búsqueda) para que siga perteneciendo también al mensaje original.

#### La edición masiva solo toca lo que tiene sentido compartir
Modelo, máximo de tokens de salida y herramientas se cambian para todos los nodos seleccionados; prompts, entradas y salidas siguen editándose nodo por nodo. Si los nodos tienen valores distintos se muestran como mixtos y, si el usuario no los toca, cada nodo conserva el suyo. Los nodos que no son LLM o agente dentro de la selección no cambian.

#### Normalización: tablas en lugar de listas y referencias que sobreviven al borrado de una key
- `chats.runKey` (por ejemplo `"12,15"`) pasa a la tabla `chat_compared_runs`, una fila por corrida comparada
- `schedules.daysOfWeek` pasa a la tabla `schedule_days`
- El JSON `execution_graphs.orchestrator` se divide en las columnas `orchestratorProvider`, `orchestratorModel` y `orchestratorKeyId`
- `execution_history` referencia el grafo con el que corrió mediante `graphId` en lugar de un número de versión
- El uso, las calificaciones del juez y el orquestador referencian `api_keys` con `ON DELETE SET NULL`: borrar una key solo pierde la referencia y el registro conserva el alias, el proveedor y el modelo (como se decidió en la entrega 2)
- Las migraciones mueven los datos existentes y descartan antes las referencias a filas que ya no existen, para poder crear las claves foráneas

### Desafíos técnicos encontrados
- Whisper en `transformers.js` traducía el español al inglés al no detectar el idioma, por lo que el idioma pasó a ser una elección explícita que se recuerda.
- Las etiquetas `<think>` pueden llegar partidas entre dos fragmentos del stream; el separador retiene el final del fragmento hasta saber si es el comienzo de una etiqueta.
- React Flow ocultaba cada nodo hasta volver a medirlo y, como el grafo se reconstruye con cada evento de la corrida, los nodos parpadeaban; ahora se conservan las medidas anteriores.
- Los modelos chicos usados como juez se desvían a resumir o terminan en una llamada a herramienta en lugar de responder `SCORE` / `REASON`; un único reintento sin herramientas lo resuelve en la mayoría de los casos.
- Migrar datos guardados como texto (listas separadas por comas, JSON, números de versión que en filas viejas no eran referencias reales) sin perder información y sin violar las nuevas claves foráneas.
- El frontend muestra el mensaje recién enviado con un id temporal; para poder bifurcar desde él, el backend ahora devuelve el id guardado.

---

# User Stories

## US-A - Dictar mensajes por voz

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero dictarle mis mensajes al chat o transcribir un archivo de audio, para escribir más rápido y usar grabaciones que ya tengo.

### Valor aportado
Hablar es más rápido que escribir para pedidos largos, y las notas de voz o reuniones grabadas se vuelven material de trabajo. La transcripción es local, en línea con el diferencial de no depender de la nube.

### Criterios de aceptación
- El input del chat tiene un botón de micrófono que graba, con contador de tiempo y botones para cancelar o detener y transcribir
- Se puede elegir el idioma de la transcripción (español o inglés); la elección se recuerda y, si no hay ninguna, se usa el idioma del sistema
- La transcripción corre en el equipo, sin enviar el audio a ningún servicio; el modelo se descarga una sola vez con progreso visible ("primera vez")
- Se usa la GPU si está disponible y, si no, la CPU
- También se puede adjuntar un archivo de audio (MP3, WAV, M4A, OGG, OPUS, WebM, FLAC, AAC) para transcribirlo; si se adjuntan varios, se usa el primero y se avisa
- El texto transcripto se agrega al input para revisarlo antes de enviar, sin borrar lo que ya estaba escrito
- Las grabaciones de más de 30 segundos se transcriben completas
- Los errores se informan con un mensaje claro: permiso de micrófono denegado, micrófono inexistente u ocupado por otra app, audio sin voz reconocible o fallo de la transcripción
- Salir de la pantalla durante una grabación libera el micrófono

### DoD
Módulo `frontend/src/features/voice` (`useVoiceInput.ts`, `transcriber.worker.ts`, `VoiceInputButton.tsx`) integrado en `ChatInput`; tests de grabación, transcripción, archivo de audio y errores (`VoiceInput.test.tsx`).

> **Nota:** la entrada por voz está en el chat; el panel de chat de las ejecuciones y la barra de consulta al juez no la muestran.



## US-C - Ver fórmulas, diagramas y multimedia en las respuestas

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero que el chat muestre fórmulas, diagramas, dibujos, imágenes, video y audio, y no solo texto, para entender las respuestas técnicas sin copiarlas a otra herramienta.

### Valor aportado
Las respuestas de matemática, arquitectura o procesos se leen como corresponde en lugar de verse como código crudo.

### Criterios de aceptación
- Las fórmulas entre `$$` se muestran con KaTeX; las escritas como `\( … \)` o `\[ … \]` también, y un `$` suelto sigue siendo texto
- Un bloque ` ```mermaid ` se muestra como diagrama y uno ` ```svg ` (o un XML/HTML que es un `<svg>`) como dibujo, con pestañas para alternar entre vista y código
- Los bloques de código tienen resaltado de sintaxis, etiqueta de lenguaje y botón de copiar
- Las imágenes se ajustan al mensaje y se abren en grande; los enlaces a video o audio se reproducen en el lugar y los demás enlaces se abren fuera de la app
- Mientras la respuesta llega, un bloque todavía abierto no intenta dibujarse
- Los diagramas respetan el tema claro u oscuro
- El modelo sabe qué puede usar y solo inserta imágenes o multimedia con URLs reales

### DoD
`MessageMarkdown.tsx` con `remark-math`, `rehype-katex` y `rehype-highlight`; `CodeBlock.tsx`, `MarkdownMedia.tsx`, `lib/markdown.ts` y `renderMermaid.ts`; prompt de sistema actualizado (`strategy/shared/markdown.ts`); tests de renderizado y de las funciones auxiliares (`MessageMarkdown.test.tsx`).

---

## US-D - Ver los archivos del chat con vista previa y adjuntarlos arrastrando o pegando

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero ver de un vistazo qué archivos hay en el chat y abrirlos sin descargarlos, y adjuntar archivos arrastrándolos o pegándolos, para trabajar con archivos con menos pasos.

### Valor aportado
Completa el trabajo con archivos de las entregas 2 y 3: los archivos que entran y los que genera la IA se reconocen y se revisan dentro de la app.

### Criterios de aceptación
- Las imágenes se muestran como miniaturas y el resto como tarjetas con ícono y color según el tipo (PDF, Word, planilla, presentación, Markdown, JSON, HTML, código, texto)
- Las tarjetas de archivos generados muestran sus primeras líneas
- La vista previa grande permite pasar al archivo anterior o siguiente (también con las flechas del teclado), copiar el contenido y descargar
- Los PDF se abren en el visor; el HTML se muestra en un marco aislado; el código y el JSON con resaltado de sintaxis
- Se pueden adjuntar archivos soltándolos sobre el input o pegándolos con Ctrl+V (por ejemplo una captura); el texto pegado sigue siendo texto
- Se aplican las mismas validaciones de tipo y tamaño que con el botón de adjuntar

### DoD
`AttachmentPreview.tsx`, `AttachmentsList.tsx`, `FileKindIcon.tsx` y `lib/fileKind.ts`; descarga en línea (`?inline=1`) en el router de adjuntos; tests de vista previa (`AttachmentPreview.test.tsx`) y de arrastrar y pegar (`ChatInputFiles.test.tsx`).

---

## US-E - Corregir un mensaje enviado y reenviarlo

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero corregir un mensaje que ya envié y reenviarlo, o reutilizarlo como punto de partida, para probar una variante sin reescribir todo ni perder la conversación original.

### Valor aportado
Corregir un pedido mal formulado es una de las acciones más comunes en un chat; antes había que copiarlo a mano y empezar de nuevo.

### Criterios de aceptación
- En un mensaje del usuario, "Branch here and edit" crea un chat nuevo con el historial anterior a ese mensaje y deja el mensaje (texto y adjuntos) en el input para editarlo y enviarlo
- Desde el primer mensaje, la bifurcación crea un chat vacío para empezar de nuevo
- "Reuse in the input" copia el texto y los adjuntos de un mensaje al input del chat actual
- Bifurcar desde una respuesta de la IA sigue funcionando como en la entrega 3
- Cada mensaje tiene un botón para copiar su texto
- El chat original no se modifica; un adjunto reutilizado se copia y sigue perteneciendo también al mensaje original
- Un mensaje recién enviado se puede bifurcar apenas se guarda

### DoD
Opción `before` en `fork-chat.ts` y su endpoint; `duplicate-attachment.ts` usado por el fork y al reenviar adjuntos; acciones en `ChatMessage.tsx`; tests de bifurcar antes de un mensaje, incluidos los adjuntos (`fork-chat.test.ts`).

---

## US-F - Editar varios nodos LLM a la vez

### Actor/es
- Usuario técnico de HiveAI que arma ejecuciones

### Funcionalidad
Como usuario que arma ejecuciones, quiero seleccionar varios nodos y cambiarles el modelo, el límite de tokens y las herramientas de una sola vez, para probar otra configuración de modelos sin editar nodo por nodo.

### Valor aportado
Comparar un flujo "todo cloud" contra un mix local + cloud (entrega 2) requería cambiar el modelo nodo por nodo; ahora es un solo cambio.

### Criterios de aceptación
- En modo edición se seleccionan varios nodos con Ctrl/Cmd/Shift + clic o arrastrando un recuadro con Shift; desde un nodo LLM hay un atajo para seleccionar todos los nodos LLM
- Con dos o más nodos seleccionados se abre un panel con la lista de nodos y los campos compartidos: modelo, máximo de tokens de salida y herramientas
- Si los nodos tienen valores distintos se muestran como mixtos; un campo que no se toca conserva el valor de cada nodo
- Se puede volver al modelo por defecto o al límite por defecto del modelo
- Las herramientas se pueden agregar o quitar en todos los nodos
- Solo cambian los nodos LLM y agente; el panel indica cuántos nodos no se ven afectados
- Se pueden mover y eliminar todos los nodos seleccionados juntos (con sus conexiones)
- Prompts, entradas y salidas se siguen editando nodo por nodo

### DoD
`BulkEditPanel.tsx`, `lib/bulkEdit.ts` y edición de varias configuraciones en `graphOps.ts` / `useGraphEditor.ts`; selección múltiple en el editor visual; tests del panel (`BulkEditPanel.test.tsx`) y de la lógica de edición (`bulkEdit.test.ts`).

---

## US-G - Ver la configuración de un nodo de forma legible

### Actor/es
- Usuario de HiveAI que revisa ejecuciones

### Funcionalidad
Como usuario, quiero ver la configuración de un nodo como una lista legible y no como JSON, para entender qué hace sin entrar al modo edición.

### Valor aportado
Revisar un flujo generado por IA o importado es más rápido; un prompt largo ya no tapa el resto de la configuración.

### Criterios de aceptación
- Cada campo se muestra en su propia fila con un nombre legible (por ejemplo `systemPrompt` → "System prompt")
- Los textos largos se recortan a unas líneas con "Show more" / "Show less"
- Los valores vacíos se muestran como "Not set" y las listas vacías como "None"
- Las configuraciones anidadas se muestran en un recuadro con desplazamiento que no ocupa todo el panel

### DoD
`ConfigView.tsx` usado en `NodeDetailsPanel`; tests (`ConfigView.test.tsx`).

---

## US-H - Separar el razonamiento de la respuesta en modelos locales

### Actor/es
- Usuario de HiveAI con modelos locales

### Funcionalidad
Como usuario de modelos locales, quiero que el razonamiento del modelo se muestre aparte de la respuesta, y saber cuándo un modelo razona aunque haya apagado el thinking, para no recibir respuestas mezcladas con "pensamiento" ni esperar una mejora de velocidad que no va a llegar.

### Valor aportado
Algunos modelos locales escriben su razonamiento dentro de la respuesta: ensucian el chat y llegan como resultado a los nodos siguientes de una ejecución. Saber qué modelos razonan siempre ayuda a elegir uno más rápido en hardware modesto.

### Criterios de aceptación
- El texto entre `<think>…</think>` (o `<thinking>`) dentro de la respuesta se muestra como razonamiento y no como parte de la respuesta, aunque la etiqueta llegue partida entre fragmentos
- En las ejecuciones, ese razonamiento no pasa al resultado del nodo
- Si un modelo razona con el thinking apagado se registra, se avisa la primera vez y el botón de thinking lo indica con un aviso de que las respuestas no van a ser más rápidas
- El registro persiste entre sesiones

### DoD
`inline-thinking.ts` aplicado en el chat (`send-message.ts`) y en los nodos (`stream-model.ts`); registro en `always-thinking-store.ts` con endpoint en `model-settings`; aviso en `ThinkingToggle.tsx`; tests del registro (`always-thinking-store.test.ts`).

> **DoD ajustado:** el separador de razonamiento (`inline-thinking.ts`) **no tiene tests unitarios propios**. La detección de modelos que razonan siempre se hace solo en el chat, no al correr ejecuciones.

---

## US-I - Cortar las respuestas que entran en un bucle de repetición

### Actor/es
- Usuario de HiveAI con modelos locales chicos

### Funcionalidad
Como usuario de modelos locales chicos, quiero que HiveAI corte una respuesta cuando el modelo se queda repitiendo lo mismo, para no esperar a que llene el contexto ni recibir un texto inservible.

### Valor aportado
Un bucle puede tardar minutos en CPU y bloquear el chat o una ejecución; cortarlo a tiempo ahorra ese tiempo y deja la parte útil de la respuesta.

### Criterios de aceptación
- Se detecta cuando la respuesta (o el razonamiento) termina en un mismo fragmento repetido muchas veces; tablas, separadores y listas cortas no se cortan
- Al detectarlo se detiene la generación y se conserva el texto hasta donde empezó el bucle, con una sola copia de lo repetido
- En el chat se avisa que la respuesta se cortó y que reintentar o cambiar de modelo suele resolverlo
- En las ejecuciones el corte no se trata como un error: el nodo continúa con lo generado hasta el bucle

### DoD
`repetition-loop.ts` aplicado en el chat (`send-message.ts`) y en los nodos LLM y Agente (`stream-model.ts`).

> **DoD ajustado:** (a) el detector **no tiene tests unitarios propios**; (b) en las ejecuciones el corte queda en el log del backend y en los metadatos de la respuesta, pero **no se avisa en la interfaz**.

---

## US-J - Normalizar el modelo de datos

### Actor/es
- Desarrollador de HiveAI

### Funcionalidad
Como desarrollador, quiero que la base de datos guarde las relaciones en tablas y claves foráneas reales en lugar de listas y JSON dentro de columnas, para que la integridad la garantice la base y las consultas no dependan de parsear texto.

### Valor aportado
Evita referencias rotas (corridas comparadas o grafos que ya no existen), simplifica las consultas y deja un modelo de entidades documentable para la entrega final.

### Criterios de aceptación
- Las corridas comparadas de un chat del juez se guardan en `chat_compared_runs` (una fila por corrida) y los días de una programación en `schedule_days`
- El modelo orquestador de un grafo se guarda en columnas (`orchestratorProvider`, `orchestratorModel`, `orchestratorKeyId`)
- Cada corrida del historial referencia el grafo con el que corrió (`graphId`)
- El uso, las calificaciones del juez y el orquestador referencian la API key con una clave foránea; borrar la key no borra esos registros, que conservan alias, proveedor y modelo
- Borrar un chat, una programación o una corrida borra en cascada sus filas dependientes
- Las migraciones mueven los datos existentes sin pérdida y descartan las referencias a filas que ya no existían
- El diagrama de entidades refleja el esquema actual

### DoD
Migraciones 0015 a 0018; repositorios, casos de uso y tipos del frontend actualizados; `known-key.ts` para no referenciar keys borradas; tests de referencias a keys y corridas (`key-and-run-references.test.ts`) y de días de programación (`schedule-days.test.ts`); diagrama en `entregables/entrega-final/HiveAI - Modelo de entidades.png`.

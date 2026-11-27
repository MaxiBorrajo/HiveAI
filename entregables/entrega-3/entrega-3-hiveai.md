# Entrega 3 - HiveAI (Sprint 4, 26 Oct - 14 Nov)

> **Objetivo del sprint:** que el usuario pueda **elegir, gestionar y evaluar** sus modelos (locales y cloud) gastando lo menos posible, y trabajar con sus documentos reales.

---

## Resumen Ejecutivo

### Qué se agregó/modificó en esta iteración

HiveAI pasó de *medir* el consumo (entrega 2) a *ayudar a decidir* con esos datos: qué modelo conviene, si el equipo lo soporta, qué tan bien le va en cada tarea y cuánto cuesta. Además se amplió el trabajo con archivos y se hizo portable y automatizable el trabajo con ejecuciones.

- **Gestión de modelos locales**: pantalla de modelos con descarga desde el registro de Ollama (cola, progreso, cancelación, reintento) y eliminación con aviso de impacto.
- **Hardware**: detección de memoria y GPU, y marca de qué modelos entran en el equipo.
- **Recomendación de modelos por tipo de tarea**, a partir de un catálogo editable, el hardware, las capacidades y los resultados de evals.
- **Evals con modelo juez**, exportación y comparación de corridas (JSON, Markdown, HTML), y **perfil de capacidades por modelo** con niveles (muy bueno / bueno / regular / malo).
- **Comparación de corridas de una ejecución** con calificación opcional del juez (rediseño con pestañas y barra de consulta al juez, cuya conversación persiste).
- **Reducción automática de tokens cloud**: prompt caching, compactación del historial y otros mecanismos, aplicados por la factoría de modelos.
- **Ejecuciones programadas** (cron) con runner dentro del proceso, ejecución en segundo plano y notificaciones.
- **Archivos**: más formatos adjuntables (DOCX, XLSX, PPTX, CSV, JSON), validación en la interfaz e **indexación para búsqueda (RAG)** de los archivos de cada chat; **lectura de PDFs escaneados** (visión u OCR local) y **generación de archivos** por el chat y por las ejecuciones (Markdown, texto, CSV, JSON, DOCX y PDF).
- **Portabilidad y edición de flujos**: exportar/importar flujos (`.hiveai-flow.json`) y acomodado automático de nodos con deshacer.
- **Fork de chat** desde cualquier mensaje.
- **Tests**: tests de frontend del modal de plugins y un workflow de CI que corre los tests de backend y frontend.

### Decisiones tomadas

#### El juez califica de 0 a 100 y el aprobado sale del puntaje, no de su opinión
Un caso aprueba con 70 o más. El juez debe elegirse explícitamente y ser distinto del modelo evaluado; sin juez, los casos con juez se omiten. Cada caso guarda juez, versión de rúbrica, puntaje y justificación. Los costos del juez se registran aparte de los del modelo evaluado. (En la comparación de corridas de una ejecución, de la entrega 2, el puntaje sigue siendo de 1 a 10: son dos usos distintos del juez.)

#### La versión del set de casos es un hash, no un número a mano
Cada suite de evals tiene una versión calculada a partir de la definición de sus casos. Cambia sola al agregar, quitar o editar un caso, así nadie tiene que acordarse de subirla. Sirve para marcar corridas y perfiles de sets distintos como "no comparables" y como "desactualizados".

#### El perfil de un modelo corre en un proceso aparte
Las evals reconfiguran el microkernel de plugins y abren su propia base. Para no pisar la app en ejecución, "Evaluar" lanza un proceso hijo (`main.ts eval-profile`). Cada suite guarda sus métricas al terminar, de modo que cancelar o fallar no pisa el perfil anterior.

#### Catálogo de recomendaciones editable sin tocar código
Hay un catálogo por defecto (`default-catalog.ts`) que el usuario puede ampliar o pisar en `~/.hiveai/config/model-catalog.json`. Los puntajes del catálogo son puntos de partida curados a mano; cuando existen resultados de evals del modelo se combinan con ellos.

#### Reducción de tokens: automática y sin interfaz
Los mecanismos se aplican en `createChatModel` solo a proveedores cloud, caen al comportamiento sin optimizar ante un fallo y se activan o desactivan por código para poder medirlos. **No se truncan resultados de herramientas** (se dejó fuera de la implementación) porque limitaría la lectura de páginas web; en su lugar se compactan los resultados viejos ya consumidos. Medición propia (Sonnet 5.5, tres ramas, una key por rama, contrastada con la consola del proveedor): chat −72 % de costo, ejecución simple −48 %, ejecución con lecturas repetidas −73 %, con los hechos esperados conservados (27/27 y 12/12).

#### Ejecuciones programadas: un atraso nunca corre en silencio
Una corrida detectada con más de 2 minutos de atraso se registra como "perdida" y **no se ejecuta**; la interfaz ofrece "Ejecutar ahora" o descartar. Hay una programación por ejecución y un único motor cron propio (diaria y semanal son presets). Las aprobaciones de plugins se aceptan automáticamente igual que en una corrida manual y el asistente lo advierte.

#### La app sigue viva en segundo plano con una ventana oculta
Se descubrió con el instalador compilado (`.deb`) que el evento de cierre del webview no es cancelable y que el runtime termina cuando no queda ninguna ventana; además, en GNOME no hay bandeja del sistema. Se resolvió con una segunda ventana minúscula oculta que mantiene vivo el proceso y el scheduler. También se usa una única instancia por usuario, porque dos instancias dispararían cada corrida dos veces.

#### Los formatos se convierten al adjuntar
Cada formato se convierte a texto (o imagen) al subirse; el texto de todos los adjuntos de un mensaje se limita (100.000 caracteres en cloud, la mitad del contexto en locales) y el resto llega mediante búsqueda sobre los fragmentos indexados con `nomic-embed-text` en local, por lo que funciona sin conexión y con modelos cloud. Los formatos se documentan en `docs/attachments.md`.

#### PDFs escaneados: enfoque híbrido con OCR local
Una página con casi nada de texto pero con una imagen se trata como escaneo (las páginas en blanco no). Orden: capa de texto; si el modelo tiene visión, las páginas van como imágenes (hasta 10 por mensaje); si no, o pasado ese límite, texto leído por OCR. El OCR corre en local con Tesseract (español e inglés), en segundo plano, y descarga sus datos de idioma una sola vez, después funciona sin conexión. También se aplica a imágenes dentro de Word y PowerPoint y a imágenes enviadas a un modelo sin visión.

#### Generación de archivos desde una herramienta del modelo
El chat tiene la herramienta `create_file`: la extensión decide el formato y DOCX y PDF se construyen a partir del Markdown que escribe el modelo (PDF con `pdf-lib` y fuentes estándar, para que funcione sin conexión; las letras con acento fuera del europeo occidental pierden el acento y los emoji se omiten). Un archivo fallido no corta el turno: el modelo recibe el motivo y puede corregirlo. Las ejecuciones entregan un archivo desde el nodo de fin sin que los nodos llamen a la herramienta.

#### Ollama y los modelos de Hugging Face
Se agregó descubrimiento de modelos con estimación de si entran en el equipo; la fuente por defecto pasó a ser la biblioteca de Ollama.

### Desafíos técnicos encontrados
- Un error de arranque (la ventana dejaba de existir al cerrar) solo aparecía en la app compilada y no en `deno task dev`.
- Evals sin supervisión: las herramientas que esperan al usuario (`ask_user`, aprobaciones) dejaban colgados los casos; ahora se resuelven como "el usuario no respondió".
- El modelo "negaba" haber usado herramientas en turnos anteriores porque el historial se reenviaba como texto plano; ahora se agrega una nota breve con las herramientas usadas.
- El resumidor del historial heredaba los callbacks del grafo y su salida se mostraba al usuario como parte de la respuesta.
- Los ids de ejecución llegan como número al frontend pero están tipados como texto; la comparación se centralizó para que el aviso de "corriendo por programación" no desaparezca.

---

# User Stories

## US-A - Calificar las evals con un modelo juez

### Actor/es
- Usuario de HiveAI que ejecuta evals

### Funcionalidad
Como usuario que evalúa modelos, quiero que un modelo juez califique las respuestas de las evals, para medir calidad en casos donde no hay una respuesta exacta.

### Valor aportado
Las comparaciones local vs cloud y con vs sin optimización (tokens, RAG) necesitan una métrica de calidad, no solo de costo.

### Criterios de aceptación
- Un caso puede declarar una rúbrica en texto, una respuesta de referencia, o ambas
- Un modelo configurable actúa como juez y devuelve puntaje (0 a 100) y justificación por caso
- El juez se elige explícitamente y es independiente del modelo evaluado
- La corrida registra qué juez y qué versión de rúbrica se usó
- Puntaje y justificación se guardan por caso, para la exportación y la comparación de corridas (US-I)
- Si el juez falla o devuelve un formato inválido, el caso queda "sin evaluar" y no rompe la corrida
- Los casos con criterio exacto siguen funcionando sin juez

### DoD
Juez en `backend/core/ai/judge/judge.ts` y suite `summarization` con rúbrica por caso; tests con juez simulado, incluido el caso de fallo; documentado en `docs/llm-eval.md`.

---

## US-B - Recomendar modelos según el tipo de tarea

### Actor/es
- Usuario de HiveAI, con modelos locales (Ollama) y cloud (API keys)

### Funcionalidad
Como usuario, quiero que HiveAI me recomiende qué modelos usar según el tipo de tarea (código, resumen, análisis de documentos, imágenes, etc.), para elegir bien sin tener que probar modelo por modelo.

### Valor aportado
Evita malas elecciones: un modelo local que no entra en el equipo, uno cloud caro para una tarea simple o uno sin visión para una imagen. Refuerza el diferencial de gastar lo menos posible.

### Criterios de aceptación
- Hay un conjunto definido de tipos de tarea: conversación general, código, resumen, análisis de documentos y datos, razonamiento, imágenes (visión) y herramientas
- El chat detecta el tipo de tarea (heurísticas más un clasificador con un modelo chico) y, si hay modelos mejores, muestra una nota bajo la respuesta con un botón para cambiar
- En "Explorar modelos" el usuario elige un modelo y le pide sugerencias, y se muestran como lista
- Solo se consideran modelos disponibles (locales instalados, cloud con key); si no hay ninguno apto se sugiere uno para instalar o configurar
- Cada recomendación indica local o cloud y, si es cloud, el costo estimado
- Los modelos que no entran en el hardware se marcan como no recomendados con el motivo
- Imágenes exige visión y herramientas exige tool calling
- Se apoya en capacidades declaradas y en resultados de evals; sin evals se indica que se basa solo en capacidades y costo
- Es una sugerencia: el usuario puede elegir otro modelo
- El catálogo es editable sin cambiar código
- Si no hay datos suficientes para una tarea, se informa

### DoD
Módulo `model-recommendations` con catálogo por defecto y almacén editable; recomendación visible en el chat y en Explorar modelos; tests de filtrado, clasificación, catálogo y señal de evals (`tests/unit/modules/model-recommendations`).

> **DoD ajustado:** la recomendación aparece en el chat y en Explorar modelos, **no en el selector de modelo de los nodos LLM**.

---

## US-C - Programar una ejecución para que corra sola

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero programar una ejecución para que corra sola (por ejemplo, todos los días a las 10), para automatizar tareas repetitivas.

### Valor aportado
Convierte las ejecuciones en tareas recurrentes baratas con modelos chicos.

### Criterios de aceptación
- Se define una frecuencia (cada N minutos u horas, diaria, semanal, hora fija o expresión cron) con vista previa de las próximas corridas
- Se puede pausar, editar y eliminar la programación (una por ejecución)
- Cada corrida programada queda en el historial, con su consumo
- Si la app no estaba disponible a la hora prevista, se registra como "perdida", se avisa y no corre en silencio; el usuario decide ejecutarla ahora o descartarla
- Una ejecución que requiere entrada del usuario no se puede programar sin una entrada fija
- La app sigue corriendo en segundo plano al cerrar la ventana y avisa con notificaciones al iniciar, terminar, fallar o perder una corrida
- Si la ventana está abierta, la corrida se ve como una corrida manual y al terminar se abre el resultado

### DoD
Tablas `schedules` y `schedule_runs` (migraciones 0009 a 0011), scheduler dentro del proceso (`backend/modules/schedules`), asistente en la interfaz y tests de cron, próxima corrida, scheduler y consumo de la corrida. Probada con una ejecución real que se dispara sola en el instalador `.deb` (Debian 13, GNOME/X11).

---

## US-D - Adjuntar más tipos de archivo a un chat o ejecución

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero adjuntar más tipos de archivo a un chat o ejecución, para trabajar con mis documentos reales sin convertirlos a mano.

### Valor aportado
El usuario no tiene que preparar sus archivos antes de usarlos.

### Criterios de aceptación
- Formatos soportados y documentados: texto plano, Markdown, CSV, JSON, DOCX, XLSX/XLS, PPTX, PDF con texto e imágenes (PNG, JPG, GIF, WebP)
- Cada formato se convierte a texto (o imagen) antes de llegar al modelo
- Un formato no soportado o demasiado grande (50 MB; 5 MB para imágenes) se rechaza al adjuntar, con un mensaje que indica cuáles sí se pueden usar; se valida en la interfaz y en el backend
- Los archivos grandes siguen el mismo tratamiento: se truncan con aviso y el resto llega por búsqueda (ver US-E)
- Funciona igual en chat y en ejecuciones

### DoD
Conversión por formato (`office-text-extractor.ts`, `create-attachment.ts`), validación de tipo y tamaño en la interfaz, tests de formatos y documentación en `docs/attachments.md`.

---

## US-E - Buscar dentro de los archivos adjuntos de un chat (RAG)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero que el modelo encuentre lo relevante dentro de archivos largos o de turnos anteriores, para trabajar con documentos que no entran enteros en el contexto.

### Valor aportado
Los documentos largos dejan de truncarse a ciegas y se reduce el contexto que se envía en cada mensaje.

### Criterios de aceptación
- Los archivos de cada chat se dividen en fragmentos y se indexan en local con `nomic-embed-text` (funciona sin conexión y con modelos cloud)
- En cada turno se buscan los fragmentos más relevantes de todos los archivos del chat y se agregan al mensaje (hasta 12.000 caracteres en cloud y un cuarto del contexto en locales)
- La indexación corre en segundo plano, no demora el mensaje, avisa mientras no termina y se retoma tras reiniciar
- Los archivos previos a la funcionalidad se indexan al usar su chat
- Las imágenes no se indexan; las ejecuciones leen sus archivos completos

### DoD
Tabla `attachmentChunks`, indexación y búsqueda con tests; el fork copia los fragmentos; documentado en `docs/attachments.md`.

---

## US-F - Reducir automáticamente los tokens en modelos cloud

### Actor/es
- Usuario de HiveAI que usa modelos cloud (chat o ejecuciones)

### Funcionalidad
Como usuario, quiero que HiveAI aplique automáticamente mecanismos que reduzcan los tokens que consumo en modelos cloud, para que el costo de mis API keys sea el menor posible sin optimizar nada a mano.

### Valor aportado
Quien elige cloud no paga de más por ineficiencias del harness. Sostiene el diferencial de gastar lo menos posible.

### Criterios de aceptación
- Mecanismos implementados: prompt caching de Anthropic, compactación determinística de resultados de herramientas ya consumidos, resumen del historial viejo con el modelo chico del proveedor, sin thinking en las continuaciones del ciclo de herramientas, guarda contra llamadas duplicadas, prompt de sistema y descripciones de herramientas más cortos para cloud
- Se aplican automáticamente en chat y ejecuciones con modelos cloud, sin configuración
- Un proveedor que no soporta un mecanismo lo omite sin error; un fallo cae al comportamiento sin optimizar
- Cada mecanismo se activa por código (`ChatModelOptions.tokenSavings` o `setTokenSavingsDefaults`) y no se expone en la interfaz
- Los casos de prueba existentes no cambian de resultado

### DoD
Mecanismos en `backend/core/ai/token-savings` usados por la factoría única; tests unitarios por mecanismo, incluido fallo y proveedor no soportado; chat y ejecución de punta a punta con un modelo cloud, con scripts de benchmark (`backend/scripts/token-savings-benchmark*.ts`) y casos manuales en `pruebas.md`.

---

## US-G - Saber si el equipo puede correr modelos locales

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero que HiveAI me diga si mi equipo puede correr modelos locales, para decidir entre local y cloud.

### Valor aportado
Evita descargar modelos que no entran o no rinden y refuerza el uso de local cuando el equipo alcanza.

### Criterios de aceptación
- Detecta memoria total, memoria disponible y presencia de GPU utilizable (descarta las integradas con poca memoria reservada; Apple Silicon usa memoria unificada)
- Marca qué modelos entran y cuáles no, con el motivo
- Si ningún modelo con tools entra, lo indica y sugiere uno cloud
- Considera el contexto que ocupan los plugins instalados

### DoD
Módulo `hardware` (`detect-hardware.ts`, `estimate-memory.ts`, `plugin-context-cost.ts`, `evaluate-compatibility.ts`) integrado en la pantalla de modelos, el descubrimiento de modelos y la descarga; tests con perfil con GPU y sin GPU.

> **DoD ajustado:** se verificó en un equipo sin GPU; el perfil con GPU está cubierto solo por tests unitarios con datos simulados.

---

## US-H - Evaluar un modelo y guardar su perfil de capacidades

### Actor/es
- Usuario de HiveAI que evalúa modelos

### Funcionalidad
Como usuario, quiero correr las evals sobre un modelo específico y que HiveAI guarde cómo le fue en cada métrica, para saber en qué es bueno o malo sin volver a probarlo.

### Valor aportado
Convierte números sueltos en conocimiento durable por modelo (por ejemplo, routing 90 % = muy bueno), útil para elegir y para alimentar las recomendaciones (US-B).

### Criterios de aceptación
- Desde la pantalla de modelos hay una acción "Evaluar" sobre un modelo concreto (local o cloud), con elección de categorías (routing, abstención, extracción de parámetros, multi-turno, generación, ejecución, resumen) o todas
- Cada métrica produce un valor (porcentaje de aprobados o puntaje promedio del juez ÷ 100) y un nivel: muy bueno (≥ 90 %), bueno (70-89 %), regular (50-69 %), malo (< 50 %), con umbrales configurables y documentados
- Se guarda por métrica: valor, nivel, fecha, versión del set de casos, juez, versión de rúbrica, versión del modelo (digest de Ollama), tokens, costo y tiempo
- Se conserva el historial y el perfil muestra el último resultado y su evolución
- Los casos "sin evaluar" no cuentan en el porcentaje y se muestra cuántos fueron
- Una métrica con menos de 5 casos se marca con baja confianza
- El perfil indica si está desactualizado (cambió el set de casos o la versión del modelo) y avisa si cambió el juez
- Con cloud se muestra el costo estimado antes de correr y se pide confirmación
- Cancelar o fallar no pisa el perfil anterior: cada suite se guarda al terminar y de forma atómica
- Se puede exportar a Markdown, HTML o JSON junto con los resultados
- Sin perfil, la recomendación se basa solo en capacidades

### DoD
Corrida por modelo y métrica, clasificación por umbrales, perfil persistido en `~/.hiveai/evals`, vista de perfil en la pantalla de modelos (`EvalProfilePanel`) y tests; documentado en `docs/llm-eval.md`.

---

## US-I - Exportar resultados de evals y compararlos

### Actor/es
- Usuario de HiveAI que ejecuta evals (desarrollador)

### Funcionalidad
Como desarrollador de HiveAI, quiero exportar los resultados de una eval y compararlos con otras corridas, para sacar conclusiones y presentarlas.

### Valor aportado
Las evals respaldan el diferencial: hay que poder mostrarlas fuera de la app y ver cuánto cambia el resultado entre configuraciones.

### Criterios de aceptación
- Exportación a JSON (completo), Markdown (legible) y HTML (autocontenido); PDF queda fuera
- El reporte incluye resumen (casos, aprobados, sin evaluar, puntaje del juez, tokens, costo, tiempo, modelo, juez, configuración), tabla por categoría y detalle por caso
- Se comparan 2 o más corridas lado a lado: diferencia de puntaje, tokens, costo y tiempo, y casos que mejoraron o empeoraron
- La comparación incluye el puntaje del juez por corrida y por caso, y la justificación al abrir un caso (HTML)
- Si los jueces o versiones de rúbrica difieren, se advierte que no son comparables
- Los casos "sin evaluar" se listan aparte y no cuentan en los promedios
- La comparación indica qué diferencia a las corridas (modelo, juez, configuración como `--config rag=on`)
- Una categoría con un set de casos distinto se marca como no comparable

### DoD
Comandos `deno task eval:export` y `deno task eval:compare`; el costo se calcula con `pricing.ts` y la versión del set de casos con `casesVersion.ts`.

---

## US-J - Test de frontend del modal de plugins

### Actor/es
- Desarrollador de HiveAI

### Funcionalidad
Como desarrollador, quiero una prueba de frontend automatizada que ejercite el flujo de plugins, para detectar regresiones de la interfaz sin probar a mano.

### Valor aportado
Los plugins son el núcleo del producto y el catálogo, la instalación y los permisos tocan esta interfaz.

### Criterios de aceptación
- Un test automatizado recorre listar, instalar o registrar, invocar con confirmación, rechazar y desinstalar un plugin
- Usa un plugin de prueba y un modelo simulado, sin red ni Ollama
- Corre en CI y hace fallar el build ante una regresión
- Hay al menos un camino feliz y uno de error

### DoD
Suite de Vitest para el modal de plugins y la vista de pruebas (estado en ejecución, resultado aprobado y fallido, motivo de la falla, confirmar o rechazar); workflow `.github/workflows/ci.yml` con jobs de tests de frontend y de backend en cada push a `main` o `dev` y en cada pull request.

> **Nota:** los tests consultan por rol y etiqueta accesible o `data-testid`, no por clases CSS.

---

## US-K - Comparar varias corridas de una ejecución, con calidad según un juez

### Actor/es
- Usuario de HiveAI que arma y corre ejecuciones

### Funcionalidad
Como usuario, quiero comparar varias corridas de una misma ejecución, incluyendo la calidad según un modelo juez, para saber qué modelo o configuración da mejores resultados en mi flujo.

### Valor aportado
Sin una comparación el usuario decide a ojo. Es la contraparte, para flujos propios, de la comparación de evals (US-I).

### Criterios de aceptación
- Desde el historial se seleccionan de 2 a 4 corridas y se comparan lado a lado
- Por corrida: entrada, resultado, modelo, tokens, tiempo y estado
- Cada corrida puede calificarse con el juez usando una rúbrica que el usuario escribe (y opcionalmente una respuesta de referencia); la calificación es opcional
- Se muestran puntaje y justificación por corrida y la diferencia
- Se registran juez y versión de rúbrica; si difieren, se advierte que no son comparables
- Si el juez falla, la corrida queda "sin evaluar" y el resto de la comparación sigue
- Si las entradas difieren o no se registraron, se avisa
- El usuario puede consultar al juez con una barra contextual y esa conversación se conserva para ese conjunto de corridas

### DoD
Comparación sobre el historial de corridas con pestañas y barra de consulta; la conversación del juez se persiste por ejecución y conjunto de corridas (`chats.executionId` + `runKey`); calificación opcional probada con corridas reales de un mismo flujo con modelos distintos.

> **DoD ajustado:** la app **no calcula costos en dinero** para las corridas de ejecuciones (solo tokens); el costo en dinero existe únicamente en las evals (US-I).

---

## US-L - Exportar e importar flujos

### Actor/es
- Usuario técnico de HiveAI

### Funcionalidad
Como usuario técnico, quiero exportar e importar flujos (ejecuciones), para compartirlos, respaldarlos y reutilizarlos.

### Valor aportado
Sin portabilidad los flujos quedan atrapados en una instalación.

### Criterios de aceptación
- Un flujo se exporta a un archivo `.hiveai-flow.json` autocontenido: nodos, conexiones, configuración y versión del formato
- Al importar se valida con las mismas reglas que un flujo creado a mano (`validateGraph`)
- Si referencia plugins no instalados, se informa cuáles faltan y el flujo no se activa
- Si el flujo incluye código de plugins, se revisa antes de aceptar la importación
- Los secretos y API keys nunca se exportan
- Importar no pisa un flujo existente sin confirmación
- Una versión de formato no soportada se rechaza con un mensaje claro

### DoD
Export e import implementados con comprobaciones de portabilidad y tests (`tests/unit/modules/executions/portability`), incluidos un archivo corrupto y uno con plugins faltantes.

> **DoD ajustado:** el criterio original mencionaba exportar también **estrategias**; esta entrega cubre solo ejecuciones.

---

## US-M - Acomodar los nodos automáticamente en el editor de grafos

### Actor/es
- Usuario técnico de HiveAI

### Funcionalidad
Como usuario del editor de grafos, quiero acomodar los nodos automáticamente, para que un flujo grande sea legible sin mover cada nodo a mano.

### Valor aportado
Mejora la usabilidad del editor y de los flujos importados o generados por IA.

### Criterios de aceptación
- Un botón "Ordenar" reubica todos los nodos según el sentido del flujo, sin superposiciones; hay menú para elegir la dirección
- Se puede deshacer la acción
- No cambia conexiones ni configuración, solo posiciones
- Los flujos importados o generados por IA se acomodan al abrirlos

### DoD
Layout con dagre en el editor (`useGraphEditor.ts`, `EditModeBar.tsx`) y deshacer funcionando.

---

## US-N - Eliminar modelos locales que ya no se usan

### Actor/es
- Usuario de HiveAI con Ollama

### Funcionalidad
Como usuario, quiero eliminar modelos locales que ya no uso, para liberar espacio en disco sin salir de HiveAI.

### Valor aportado
Los modelos locales ocupan varios GB; borrarlos desde la misma pantalla cierra el ciclo de administrarlos.

### Criterios de aceptación
- Cada modelo instalado muestra su tamaño y una acción "Eliminar"
- Antes de borrar se pide confirmación con el nombre y el espacio que se libera, e indica qué chats y estrategias lo usan (`GET /api/models/:name/impact`); borrarlo no modifica esos elementos
- Un elemento que referencia un modelo eliminado muestra un error accionable (`model_unavailable`) con la opción "Descargar de nuevo", en vez de fallar sin explicación
- No se puede eliminar un modelo en uso en ese momento (chat respondiendo o ejecución en curso), el activo ni el de embeddings
- Al terminar, el modelo desaparece de los selectores y se actualiza el espacio
- Un fallo al borrar se informa y el modelo sigue listado
- Los resultados de evals y el perfil se conservan tras eliminarlo

### DoD
Eliminación con confirmación e impacto, probada con un modelo sin uso, uno referenciado y uno en uso; tests del tracker de actividad y de la búsqueda de uso.

---

## US-O - Bifurcar una conversación desde cualquier mensaje

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero bifurcar la conversación desde cualquier mensaje, para explorar alternativas sin perder el hilo original.

### Valor aportado
Probar variantes de un prompt o volver a un punto anterior sin empezar de cero ahorra tiempo y tokens.

### Criterios de aceptación
- Desde cualquier mensaje se crea un chat nuevo con una copia del historial hasta ese mensaje inclusive
- El chat original no se modifica
- Volver a un punto anterior se hace con fork (no hay "restore")
- El fork hereda la estrategia y la configuración
- Los adjuntos y archivos generados hasta ese mensaje se copian y se indexan de forma independiente; los posteriores no pasan al fork

### DoD
`fork-chat.ts` con endpoint y acción en `ChatMessage`; tests unitarios (`fork-chat.test.ts`) y copia de fragmentos indexados.

---

## US-P - Descargar modelos locales desde HiveAI

### Actor/es
- Usuario de HiveAI con Ollama

### Funcionalidad
Como usuario, quiero descargar modelos locales desde HiveAI con pocos clics, para empezar a usarlos sin abrir la terminal ni conocer los comandos de Ollama.

### Valor aportado
Baja la barrera de entrada y hace posible probar y comparar modelos.

### Criterios de aceptación
- Pantalla de modelos con los instalados y una pestaña "Descargar" para elegir uno por nombre y etiqueta (por ejemplo `gemma3n:e4b`), con exploración por la biblioteca de Ollama o Hugging Face
- Antes de empezar se muestra el tamaño y el espacio libre; si no alcanza se avisa, y se advierte si probablemente no entra en el equipo (aviso, no bloqueo)
- Progreso (porcentaje y velocidad), cancelación sin dejar un modelo a medias listado y reintento ante una interrupción
- Cola de descargas (2 en paralelo) con el estado de cada una
- Al terminar, el modelo aparece en los selectores y se leen sus capacidades (visión, tools)
- Si Ollama no está instalado o no responde, o el nombre no existe, se informa con un mensaje claro sin romper la pantalla

### DoD
Gestor de descargas (`pull-manager.ts`) con tests; probada con un modelo chico real y con casos de error (sin red, nombre inexistente, sin espacio, Ollama caído).

---

## US-Q - Que el chat genere archivos

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero que el chat pueda generar archivos (documentos, CSV, código), para recibir el resultado listo para usar en lugar de copiarlo del texto.

### Valor aportado
Cierra el ciclo del trabajo con archivos: entran documentos y salen documentos.

### Criterios de aceptación
- El modelo produce un archivo como resultado de una respuesta con la herramienta `create_file`
- El archivo aparece bajo la respuesta como adjunto descargable, con vista previa (Markdown renderizado, CSV como tabla, JSON con sangría, texto de DOCX y PDF)
- Formatos: Markdown, texto, CSV, JSON (debe ser válido), DOCX, PDF y archivos de código
- El archivo queda asociado al chat, se indexa para búsqueda y puede reutilizarse en mensajes posteriores
- Un fallo (JSON inválido, formato no soportado, más de 50 MB) se informa y no interrumpe la conversación: el modelo recibe el motivo y puede corregirlo
- Las ejecuciones también entregan un archivo desde el nodo de fin, construido con los mismos formatos

### DoD
Herramienta `create_file` (`native-tools.ts`), conversión de Markdown a DOCX y PDF (`markdown-docx.ts`, `markdown-pdf.ts`), vista previa en la interfaz (`AttachmentPreview`) y tests por formato y de error (`generated-files.test.ts`, `deliverable-files.test.ts`, `AttachmentPreview.test.tsx`); documentado en `docs/attachments.md`. Los límites de tamaño y el truncado de salidas largas siguen vigentes.

> **Nota:** la herramienta existe solo en el chat; los nodos de una ejecución no pueden llamarla. El PDF usa las fuentes estándar y no cubre todos los caracteres (ver Decisiones).

---

## US-R - Leer PDFs escaneados

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario, quiero que HiveAI pueda leer PDFs escaneados, para trabajar con documentos aunque no tengan texto seleccionable.

### Valor aportado
Muchos documentos reales (facturas, contratos, apuntes) son escaneos y antes eran invisibles para el modelo.

### Criterios de aceptación
- HiveAI detecta las páginas sin capa de texto (poco texto y una imagen; las páginas en blanco no cuentan)
- Orden de tratamiento: (1) con capa de texto se usa ese texto; (2) si el modelo tiene visión, las páginas se envían como imágenes (hasta 10 por mensaje); (3) si no, o pasado ese límite, OCR local; (4) si no se pudo leer, se informa con un mensaje claro
- El texto extraído sigue el mismo camino que el de un PDF normal: truncado e indexación para búsqueda
- El adjunto muestra el progreso del procesamiento en documentos largos
- Funciona sin conexión: el OCR es local (Tesseract, español e inglés) y sus datos de idioma se descargan una sola vez
- Se aplica también a imágenes dentro de Word y PowerPoint (PNG y JPEG, hasta 20 por archivo) y a imágenes enviadas a un modelo sin visión

### DoD
Detección, OCR y estado de progreso (`scan-recognition.ts`, `scanned-content.ts`, `useScanProgress.ts`) con tests (`scanned-documents.test.ts`); documentado en `docs/attachments.md`.

---

## US-S - Enviar los errores de validación de una ejecución a la IA

### Actor/es
- Usuario de HiveAI que edita ejecuciones

### Funcionalidad
Como usuario, quiero enviar los errores de validación de una ejecución a la IA, para que los arregle por mí al editar un flujo.

### Valor aportado
Convierte el mensaje de error en una acción de un clic, en lugar de obligar a interpretarlo y corregirlo a mano.

### Criterios de aceptación
- Cuando una ejecución no valida, el botón "Fix with AI" envía los errores al asistente, que regenera el grafo con el cambio más pequeño posible
- La propuesta pasa por la misma validación que cualquier flujo
- Funciona con modelos locales y cloud

### DoD
Botón en `ValidateGraphModal` conectado al generador (`handleFixWithAi` en `ExecutionsMain.tsx`).


# PoC - HiveAI

## Resumen Ejecutivo

### Qué se agregó/modificó en esta iteración

Durante la PoC del proyecto **HiveAI** (agente de IA local, extensible mediante plugins, corriendo como aplicación de escritorio sobre Deno) se desarrolló el flujo completo de un asistente conversacional local: desde la configuración del modelo de IA hasta la ejecución de acciones concretas sobre el sistema del usuario a través de un catálogo de plugins.

En esta etapa se implementaron y validaron:

- **Interfaz de chat** con persistencia de conversaciones, memoria de contexto por chat y streaming en vivo del razonamiento del agente ("pensamiento") mientras genera una respuesta.
- **Configuración del modelo local**: selección de modelo en tiempo real y modos de ejecución (light/full/custom) para balancear velocidad y calidad según el hardware disponible.
- **Transparencia del proceso del agente**: cada respuesta puede auditarse abriendo el detalle de los pasos internos que siguió el agente para llegar a ella.
- **Catálogo de plugins de fábrica**, extensible con plugins propios: búsqueda web, búsqueda de archivos, ejecución de comandos de shell (con aprobación humana explícita), entre otros.
- **Importación de plugins externos** mediante carga dinámica, validados contra un contrato estructural (`BeePlugin`) antes de aceptarlos, ejecutados en un proceso aislado del backend principal.
- **Evaluación de plugins**: cada plugin declara sus propios casos de prueba (selección de herramienta y ejecución de lógica), corribles desde la interfaz con métricas de tasa de éxito, resiliencia, latencia y tokens consumidos.

### Decisiones tomadas

#### Simplificación de la estrategia de orquestación (SCOUT vs. SADER)

Se evaluaron dos arquitecturas para la decisión de qué herramienta invocar ante un mensaje del usuario: una con verificación explícita de abstención en un paso separado (varios nodos especializados encadenados), y otra con tool-calling directo de un único modelo. Se corrió un experimento comparativo propio (mock plugins + set de consultas con resultado esperado) y el enfoque directo resultó mejor en las cuatro dimensiones medidas (precisión de selección, tokens, latencia, errores). Se adoptó como estrategia única de producción, dejando la arquitectura descartada documentada como referencia.

#### Aislamiento de plugins externos en un proceso separado

Para permitir que el usuario importe plugins de terceros sin comprometer el proceso principal del backend, se decidió correr el código importado en un subproceso Deno independiente, comunicado por RPC, en lugar de cargarlo directamente en el proceso del microkernel.

#### Priorización de funcionalidad sobre cobertura de tests en esta iteración

Dado que el objetivo de esta etapa era validar la viabilidad del producto de punta a punta, se priorizó completar el flujo funcional por sobre construir una suite de tests automatizados. La validación de esta iteración fue manual, y agregar tests quedó identificado como tarea explícita para la siguiente.

### Desafíos técnicos encontrados

- Comparación empírica de arquitecturas de decisión de herramientas (tool-calling directo vs. verificación explícita de abstención) con recursos de hardware local limitados.
- Ejecución de comandos de shell y acceso al sistema de archivos del usuario de forma que el usuario mantenga control real sobre lo que el agente hace, sin que la aprobación humana sea el único mecanismo de protección.
- Selección correcta de plugin cuando dos herramientas cubren casos de uso cercanos (por ejemplo, búsqueda de archivos vs. lectura de un archivo puntual).
- Balance entre velocidad y calidad de respuesta corriendo modelos de lenguaje en hardware de usuario final, sin infraestructura de servidor dedicada.

---

# User Stories

## US1 - Configurar el modo de ejecución del modelo local

### Actor/es
- Usuario técnico de HiveAI (dev/power user)

### Funcionalidad
Como usuario técnico quiero poder configurar el modo de ejecución del modelo local (light, full o custom) para equilibrar velocidad y calidad de respuesta según mi hardware y necesidad puntual.

### Valor aportado
Permite adaptar el rendimiento del agente al hardware disponible, en lugar de forzar una única configuración que puede ser lenta en equipos modestos o subóptima en equipos potentes.

### Criterios de aceptación
- El usuario puede ver los modos disponibles con una descripción de qué implica cada uno
- El usuario puede seleccionar un modo y que se aplique a las siguientes ejecuciones del modelo, sin reiniciar la app salvo que un parámetro lo requiera explícitamente
- En modo custom, el usuario puede ajustar parámetros individuales dentro de rangos permitidos, viendo su valor actual y el default
- El modo y los parámetros elegidos persisten entre sesiones
- Un valor fuera de rango en modo custom es rechazado con feedback claro, sin romper la configuración vigente

---

## US2 - Cambiar el modelo activo en tiempo real

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero poder cambiar el modelo actual en tiempo real, para adaptar la inteligencia y velocidad del agente local a las necesidades específicas de la conversación en curso.

### Valor aportado
Da flexibilidad para alternar entre un modelo rápido para tareas simples y uno más pesado para razonamiento complejo, sin reiniciar el flujo de trabajo ni la aplicación.

### Criterios de aceptación
- Cada modelo inactivo en la lista tiene un control para seleccionarlo
- Al seleccionarlo, se actualiza el modelo en uso en el backend
- La interfaz marca el nuevo modelo como seleccionado y deshabilita su propio botón de acción
- El cambio persiste en la sesión: los próximos mensajes usan el nuevo modelo

---

## US3 - Ver el proceso interno del agente

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero poder ver el proceso interno que sigue el agente para llegar a una respuesta (los pasos que ejecutó, en orden, con su duración y un resumen de lo que hizo cada uno) para poder auditar y confiar en cómo se generó esa respuesta.

### Valor aportado
Da transparencia y confianza sobre las respuestas del agente, permitiendo entender cómo llegó a una conclusión en lugar de recibirla como una caja negra.

### Criterios de aceptación
- Cada mensaje del agente que involucró pasos internos permite abrir un detalle ("Ver pasos") que los muestra en orden
- Cada paso muestra la etapa, una etiqueta descriptiva, su duración y un resumen de lo que hizo
- Si el agente ejecutó más de un paso, el detalle refleja todos en el orden real en que ocurrieron
- Si la respuesta no usó ninguna herramienta, el detalle igual muestra el resumen del razonamiento que llevó a esa decisión
- El detalle está colapsado por defecto y se abre bajo demanda

---

## US4 - Ver el pensamiento del agente en vivo

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero ver, mientras espero una respuesta, el texto de "pensamiento" que va generando el agente en cada etapa del proceso, para saber que está trabajando activamente y entender en qué está enfocado en ese momento.

### Valor aportado
Da feedback inmediato durante la espera de una respuesta, reduciendo la incertidumbre de si el sistema se colgó o sigue procesando.

### Criterios de aceptación
- Mientras se genera una respuesta, se muestra un indicador de "pensando" con el texto que el agente va emitiendo, actualizado en tiempo real, no solo al finalizar
- Si el agente pasa por varias etapas, el texto se actualiza por cada una
- Al terminar, el pensamiento en curso se reemplaza por la respuesta final, quedando disponible en el detalle de pasos
- Si la respuesta demora, el usuario ve actividad continua, no una pantalla estática

---

## US5 - Listar modelos disponibles con su información técnica

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero poder listar los modelos de IA disponibles junto con su información técnica, para evaluar sus características y elegir el más adecuado según el hardware y la complejidad de mi tarea.

### Valor aportado
Da visibilidad sobre el inventario local de modelos descargados, permitiendo decisiones informadas sobre qué motor de inteligencia utilizar.

### Criterios de aceptación
- La interfaz despliega la lista completa de modelos detectados en el sistema
- Cada modelo expone su metadata clave: nombre, tamaño en disco en formato legible, tamaño de parámetros, nivel de cuantización y familia
- Se identifica claramente cuál es el modelo activo
- Si no hay modelos instalados, se muestra un estado vacío claro

---

## US6 - Memoria de contexto por chat

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero que el agente recuerde el contexto de los mensajes previos dentro de mi chat actual, para poder hacer preguntas de seguimiento o referirme a algo mencionado antes sin repetirlo.

### Valor aportado
Da conversaciones coherentes y naturales, sin tener que repetir información ya dada dentro del mismo chat.

### Criterios de aceptación
- Al enviar un nuevo mensaje dentro de un chat existente, el agente construye su contexto incluyendo los mensajes anteriores de ese mismo chat
- El usuario puede referirse a algo mencionado antes en el mismo chat y el agente responde usando ese contexto
- Un chat nuevo no arrastra contexto de otros chats
- El contexto de un chat no se mezcla con el de otro

---

## US7 - Guardar chats y acceder a ellos

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero que el agente guarde mis chats y pueda acceder a ellos después, para retomar una conversación anterior sin perder el historial ni el contexto generado.

### Valor aportado
Da continuidad de trabajo, permitiendo retomar conversaciones anteriores sin perder contexto ni repetir preguntas.

### Criterios de aceptación
- Cada conversación se persiste automáticamente, sin acción explícita de "guardar"
- Existe un listado de chats ordenado por actividad reciente, con título y fecha relativa
- El usuario puede crear un chat nuevo y seguir viendo los anteriores en la lista
- Al seleccionar un chat, se cargan sus mensajes completos y continúa desde ahí
- El usuario puede eliminar un chat con confirmación explícita, de forma permanente
- Si no hay chats guardados, se muestra un estado vacío claro
- Se distinguen chats con respuestas no leídas de los ya vistos

---

## US8 - Evaluar la calidad de un plugin instalado

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero ejecutar la evaluación de un plugin instalado, para saber si funciona bien antes de confiar en él.

### Valor aportado
Permite validar empíricamente que un plugin es comprendido correctamente por el modelo local, midiendo funcionamiento, velocidad y consumo de tokens, sin depender de métricas declaradas por terceros en hardware distinto.

### Criterios de aceptación
- Se pueden seleccionar y ejecutar los casos de prueba de un plugin (de selección y de ejecución) desde un modal en la interfaz
- El reporte global muestra tasa de éxito, puntaje de resiliencia ante pruebas negativas, latencia promedio, tokens consumidos y desglose por tipo de test
- Los fallos se tipifican automáticamente (error de selección de herramienta, parámetros incorrectos, error de lógica de ejecución)
- Cada caso individual permite expandir un detalle con los resultados obtenidos
- La evaluación corre de corrido con una barra de progreso en vivo, sin confirmación manual por invocación
- La evaluación puede abortarse desde la interfaz

---

## US9 - Ejecutar comandos de shell con aprobación

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero pedirle al agente que ejecute comandos de shell por mí, aprobando explícitamente cada comando antes de que se ejecute, para automatizar tareas sin salir del chat sin perder control sobre lo que corre en mi máquina.

### Valor aportado
Da automatización de tareas repetitivas sin salir del chat, manteniendo control humano sobre lo que efectivamente se ejecuta.

### Criterios de aceptación
- El agente ejecuta el comando vía shell, devolviendo salida y código de salida
- Antes de ejecutar, se solicita aprobación explícita mediante un modal que muestra el comando completo y el directorio de trabajo
- Si el usuario rechaza o no responde a tiempo, el comando no se ejecuta
- El plugin queda disponible en el catálogo por defecto al iniciar la aplicación

---

## US10 - Búsqueda web para información actualizada

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero que el agente pueda buscar en internet cuando la consulta lo requiera, para obtener información actual y verificable en lugar de una respuesta fabricada por el modelo.

### Valor aportado
Permite acceder a información posterior a la fecha de corte de entrenamiento del modelo, evitando que alucine o fabrique respuestas.

### Criterios de aceptación
- Las consultas sobre datos recientes o eventos actuales activan la búsqueda; consultas de conocimiento general no la activan innecesariamente
- La herramienta respeta el contrato estructural para ser cargada e invocada por el orquestador
- No requiere configuración adicional por parte del usuario
- Queda registrada y disponible por defecto en el catálogo, sin activación manual

---

## US11 - Importar plugins externos

### Actor/es
- Usuario técnico de HiveAI (dev)

### Funcionalidad
Como usuario técnico quiero poder importar un plugin externo para extender las herramientas de mi agente local de forma descentralizada, validando que el plugin sea seguro y compatible antes de aceptarlo.

### Valor aportado
Permite armar extensiones propias o usar las de terceros para potenciar las capacidades del agente sin limitarse a las herramientas de fábrica.

### Criterios de aceptación
- La importación se realiza subiendo una carpeta de plugin desde la interfaz
- El plugin se carga y valida en un proceso aislado, no en el proceso principal del backend
- Se valida estructuralmente que cumpla el contrato esperado antes de aceptarlo, rechazando con error claro si falta algo
- Un plugin importado queda registrado, pero requiere un paso explícito de activación para estar disponible

---

## US12 - Activar y desactivar plugins

### Actor/es
- Usuario de HiveAI (dev)

### Funcionalidad
Como usuario quiero ver la lista de plugins registrados en el microkernel y poder activarlos o desactivarlos individualmente (o todos a la vez) para que el agente solo considere los plugins habilitados al decidir cómo resolver mi pedido.

### Valor aportado
Da control sobre qué capacidades tiene disponibles el agente al decidir qué herramienta invocar, evitando invocaciones no deseadas.

### Criterios de aceptación
- Se listan todos los plugins registrados, internos y externos, con nombre, descripción y estado
- Cada plugin tiene un control para activarlo/desactivarlo individualmente, con feedback inmediato
- Existe una acción para activar o desactivar todos los plugins de una sola vez
- Un plugin desactivado no es considerado por el agente al seleccionar herramienta
- Los plugins externos muestran una distinción visual y permiten además editarlos, exportarlos y eliminarlos

---

## Spike1 - Degradación del ruteo de plugins según tamaño de catálogo

### Objetivo
Medir cuántas veces el agente elige el plugin correcto a medida que crece la cantidad de plugins disponibles, usando un modelo local fijo, para determinar si existe un umbral a partir del cual la calidad de decisión cae.

### Resultado esperado
- Set de consultas versionado con su plugin esperado
- Script reproducible que corre distintos tamaños de catálogo
- Tabla de aciertos, errores de selección y casos de abstención mal disparados, por tamaño de catálogo

### Aprendizajes
- Infraestructura de experimentación reutilizable (mock plugins sin ejecución real, evaluación automatizada de selección/parámetros) para comparar arquitecturas de decisión.
- Necesidad de correr el experimento con el diseño de catálogo vigente antes de sacar conclusiones válidas para la arquitectura actual del producto.

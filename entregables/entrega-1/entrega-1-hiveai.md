# Entrega 1 - HiveAI (Sprint 2: "Forage Sprint 2", 14 Sep - 3 Oct)

> **Objetivo del sprint:** cerrar los riesgos de seguridad abiertos en los plugins existentes y sentar las bases de **Ejecuciones**, el primer paso hacia que HiveAI resuelva tareas planificadas más allá del chat conversacional.

---

## Resumen Ejecutivo

### Qué se agregó/modificó en esta iteración

La PoC dejó a HiveAI como un asistente conversacional local con plugins. En este sprint se agregó un segundo modo de trabajo: las **Ejecuciones**. Una ejecución es un *grafo de nodos* (inicio, LLM, plugin, condición, fin) que resuelve una tarea planificada, con un estado compartido entre nodos.

- **Generación de ejecuciones desde un prompt**: el usuario describe una tarea y el backend genera el grafo en dos fases (esqueleto de topología y luego configuración nodo por nodo), transmitiéndolo por SSE para que el canvas lo dibuje en vivo.
- **Editor visual de grafos**: alta, edición y conexión manual de nodos, con validación estructural antes de guardar.
- **Revisión y corrección por prompt** de una ejecución ya generada, antes de correrla.
- **Corrida en vivo**: la ejecución se compila a un grafo de LangGraph y se ejecuta con eventos en tiempo real (nodo activo, herramienta en uso, logs) y resultado tipado (texto, tabla, archivo, etc.).
- **Persistencia de ejecuciones**: se guarda el grafo (versionado), el estado y el historial de resultados por iteración.
- **Contrato de nodo** (`GraphNode`, `GraphEdge`, `LangGraphAbstraction`) que define cómo se declara un nodo y cómo se conecta con otros.
- **Cancelar la ejecución del chat**, **modo oscuro/claro** y **aviso de actualización** de la app.
- **Hardening de plugins**: `run-shell` ahora restringe contenido y tiene timeout con abort real (FORAGE-97, FORAGE-98); el abort de `testPlugin` ahora corta la inferencia real del LLM (FORAGE-103).
- **CI/CD** (FORAGE-3): workflow de GitHub Actions que publica un release por plataforma (`.deb` y `.msi`) con cada merge a `main`.

### Decisiones tomadas

#### Generación en dos fases con validate-and-retry
Pedirle al LLM el grafo completo de una vez producía grafos inválidos (aristas colgantes, variables inexistentes, ramas de condición faltantes). Se separó en: (1) *esqueleto* de topología, validado estructuralmente y reintentado con feedback de las violaciones; (2) *configuración* de cada nodo con su propio schema. Se reemplazaron los "arreglos silenciosos" de la salida del LLM por validación y reintento explícito, y se agregó una pasada final de autocorrección de interpolaciones (`${var}`).

#### El grafo del usuario es una abstracción propia, no LangGraph directo
Se persiste `LangGraphAbstraction` (JSON) y recién al correr se compila a LangGraph (`compiler.ts`). Esto permite editarlo visualmente, validarlo y versionarlo sin acoplar la base de datos a la librería.

#### Streaming por SSE para generar y para correr
Tanto la generación como la corrida tardan por correr modelos locales. Se eligió SSE (un `POST` que responde un stream de eventos) para que el usuario vea el grafo construyéndose y el avance de la corrida.

#### Versionado de grafos e historial de resultados
Cada guardado del grafo crea una fila nueva en `execution_graphs` y cada corrida una en `execution_history` (con `iteration`). Así se puede guardar y recuperar una ejecución y sus resultados anteriores (base para FORAGE-111, iterar sobre un resultado).

#### Refactors para sostener el crecimiento
Se eliminaron contextos duplicados del frontend, se corrigió el parser SSE y se dividió `ExecutionsMain` en hooks (`useExecutionWorkspace`, `useGraphEditor`, `useRunControls`).

### Desafíos técnicos encontrados
- Lograr que un modelo local chico genere grafos válidos de forma confiable
- Mantener el estado de la UI por ejecución (generando / corriendo / editando) sin perderlo al cambiar entre ejecuciones.
- Normalizar resultados heterogéneos de plugins y LLMs a un tipo de resultado renderizable (`result-normalizer.ts`).
- Cerrar vulnerabilidades de plugins que ejecutan comandos y acceden al sistema de archivos.

---

# User Stories

## US-A - Generar una ejecución a partir de un prompt (FORAGE-106)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario de HiveAI quiero que, a partir de un prompt que describe una tarea, se genere automáticamente una ejecución (grafo de nodos) que la resuelva, para ver cómo se va a abordar antes de que empiece a correr, sin tener que armarla yo mismo.

### Valor aportado
Convierte un pedido en lenguaje natural en un plan visible y editable, en vez de una respuesta opaca de chat.

### Criterios de aceptación
- Al enviar el prompt se crea una ejecución nueva con nombre derivado del prompt
- El grafo se dibuja en vivo: se muestran el "pensamiento" de planificación y cada nodo y conexión a medida que se agregan
- Todo grafo generado tiene exactamente un nodo de inicio y uno de fin, y todo nodo es alcanzable desde el inicio y llega al fin
- Los nodos de plugin usan solo plugins activos, y los nodos de condición tienen sus dos ramas (true/false)
- Si el esqueleto generado es inválido, se reintenta con las violaciones como feedback antes de rendirse
- Si no hay modelo configurado o el prompt está vacío, se informa el error sin crear nada
- El grafo final queda guardado y disponible al reabrir la ejecución

## US-B - Armar una ejecución manualmente (FORAGE-107)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario de HiveAI quiero armar una ejecución manualmente, agregando y conectando nodos yo mismo, para tener control total del flujo sin depender de que un modelo lo genere.

### Valor aportado
Control total y determinismo; además sirve cuando el modelo local no genera un buen grafo.

### Criterios de aceptación
- Se puede crear una ejecución vacía y entrar en modo edición
- Una paleta permite agregar nodos de tipo LLM, plugin y condición, y conectarlos
- El panel de detalle del nodo permite configurar sus campos (prompt, plugin, mapeo de entradas, condición)
- Al guardar se valida el grafo (inicio/fin únicos, aristas válidas, variables definidas, parámetros de plugin) y se muestran las violaciones en un modal si las hay
- Un grafo inválido no se persiste
- El estado compartido (variables) se puede ver y editar

## US-C - Revisar y corregir una ejecución antes de correrla (FORAGE-108)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero revisar y corregir una ejecución generada antes de correrla, para que un grafo mal armado no me haga perder tiempo.

### Valor aportado
Evita corridas largas e inútiles en hardware local; el usuario corrige el plan en vez de descartarlo.

### Criterios de aceptación
- El grafo generado se puede abrir en modo edición antes de correr
- Se puede pedir una corrección por prompt sobre toda la ejecución o sobre un nodo puntual, conservando el resto del grafo
- Se puede previsualizar un cambio sin persistirlo (dry run) y descartarlo
- Los cambios aplicados quedan en una nueva versión del grafo

## US-D - Ejecutar una ejecución viendo el avance en vivo (FORAGE-109)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero ejecutar una ejecución aprobada viendo el avance en tiempo real, con la posibilidad de detenerla, para tener control sobre una tarea que puede tomar mucho tiempo.

### Valor aportado
Transparencia y control durante tareas largas, en lugar de esperar sin feedback.

### Criterios de aceptación
- El usuario puede completar las entradas requeridas y lanzar la corrida desde un modal
- Durante la corrida se resalta el nodo activo y se indica la herramienta en uso; hay un panel de logs
- La corrida puede detenerse desde la interfaz
- Al terminar se muestra el resultado con el tipo adecuado (texto, markdown, tabla, archivo, etc.) y las variables finales de estado
- Si un plugin requiere aprobación humana (ej. `run-shell`), se pide antes de correr
- Un error en un nodo se informa sin dejar la UI trabada

## US-E - Guardar y recuperar una ejecución (FORAGE-110)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero guardar una ejecución, para volver a abrirla, correrla de nuevo y consultar sus resultados anteriores.

### Valor aportado
Las tareas planificadas se vuelven reutilizables y auditables.

### Criterios de aceptación
- Las ejecuciones persisten entre sesiones y se listan
- Se pueden renombrar y eliminar (con eliminación en cascada de grafos e historial)
- Al reabrir una ejecución se carga su último grafo y su último resultado
- Cada corrida guarda un registro nuevo del historial con número de iteración

## US-F - Definir el contrato de un nodo y su conexión (FORAGE-105)

### Actor/es
- Desarrollador de HiveAI

### Funcionalidad
Como desarrollador quiero definir el contrato de un nodo de ejecución y cómo se conecta con otros en un grafo, para poder agregar nuevos tipos de nodo sin romper el generador, el editor ni el compilador.

### Valor aportado
Base común (`GraphNode`, `GraphEdge`, `LangGraphAbstraction`) compartida por backend y frontend.

### Criterios de aceptación
- Existe un tipo por nodo (`start`, `end`, `llm`, `plugin`, `condition`) con `id`, `name`, `type`, `config` y posición
- Las aristas declaran origen, destino y, si son condicionales, la rama (`true`/`false`) y la condición
- El estado compartido tiene schema tipado con estrategias de reducción (overwrite, append, merge_dict, sum, etc.)
- Un validador único rechaza grafos que violan el contrato con mensajes claros

## US-G - Cancelar la ejecución del chat (FORAGE-119)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero poder cancelar la ejecución del chat mientras el agente responde, para no esperar una respuesta que ya no necesito.

### Valor aportado
Control sobre un modelo local que puede tardar mucho.

### Criterios de aceptación
- Mientras el agente responde hay un control para cancelar
- Al cancelar se corta la generación y la UI queda lista para un nuevo mensaje
- El chat conserva lo ocurrido hasta ese momento

## US-H - Cambiar entre modo oscuro y claro (FORAGE-116)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero poder cambiar el modo de oscuro a claro, para usar la app con la apariencia que me resulte más cómoda.

### Valor aportado
Accesibilidad y comodidad visual.

### Criterios de aceptación
- Hay un control visible para alternar el tema
- Todas las pantallas respetan el tema elegido
- La preferencia persiste entre sesiones

## US-I - Aviso de nueva versión (FORAGE-2)

### Actor/es
- Usuario de HiveAI

### Funcionalidad
Como usuario quiero que la app me indique cuando hay una actualización, para saber que existe una versión nueva y poder instalarla.

### Valor aportado
Los usuarios no se quedan en versiones viejas con bugs ya resueltos.

### Criterios de aceptación
- La app compara su versión con el último release de GitHub (con caché de una hora)
- Si hay una versión más nueva, muestra un banner con el link al instalador de su sistema operativo (`.deb` / `.msi`)
- Si no hay versión nueva o no hay conexión, no muestra nada ni rompe la app

---
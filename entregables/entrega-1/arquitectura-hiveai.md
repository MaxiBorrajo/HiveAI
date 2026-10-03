# Arquitectura - HiveAI

**User story testigo:** Generar una ejecución a partir de un prompt (FORAGE-106) y correrla (FORAGE-109).

## Nodos de despliegue

- **PC del usuario**: app de escritorio (Deno Desktop). Dentro corren el frontend (webview React + Vite) y el backend (Deno + Hono en `localhost:8000`) en el mismo binario.
- **Ollama**: proceso local aparte (`localhost:11434`) que sirve el modelo de IA.
- **GitHub Releases**: servicio externo, solo para el aviso de actualización.

## Componentes por capa

### Frontend (propio, React)

| Capa | Componentes |
|---|---|
| UI / vista | `ExecutionsMain.tsx`, `ExecutionChatPanel.tsx`, `RunExecutionModal.tsx`, `visual-builder/index.tsx`, `StandardNode.tsx`, `ConditionNode.tsx` |
| Estado de vista | `useExecutionWorkspace.ts`, `useGraphEditor.ts`, `useRunControls.ts`, `ExecutionsContext.tsx` |
| Cliente API | `generateExecution.ts`, `runExecutionStream.ts`, `saveExecutionGraph.ts`, `lib/sse.ts` |

### Backend (propio, Deno + Hono)

| Capa | Componentes |
|---|---|
| Controller | `modules/executions/router.ts` (`POST /api/executions/generate`, `POST /api/executions/:id/run`, `PUT /api/executions/:id/graph`) |
| Transporte / seguridad | `core/api/sse.ts` (`createSseResponse`), `core/api/guards.ts` (`requireModelsConfigured`) |
| Casos de uso | `generate-execution.ts`, `run-execution.ts`, `update-execution-graph.ts`, `get/list/delete-execution.ts` |
| Dominio (Visual Builder) | `types.ts` (`LangGraphAbstraction`, `GraphNode`, `GraphEdge`), `generate-graph.ts`, `skeleton-phase.ts`, `topology-compiler.ts`, `skeleton-validator.ts`, `node-configuration.ts`, `validation/validate-graph.ts`, `execution/compiler.ts`, `execution/llm-executor.ts`, `plugin-node-executor.ts`, `result-normalizer.ts` |
| Plugins | `core/microkernel/hive-microkernel.ts`, plugins de fábrica (`run-shell`, `web-search`, `web-read`, `file-read`, `file-ops`, `file-search`), plugins externos en proceso aislado (`external-plugin-host.ts`, `plugin-runner.ts`) |
| Persistencia | `execution-repository.ts`, `schema/executions.ts` (`executions`, `execution_graphs`, `execution_history`), `orm.ts` → SQLite local |

### Terceros

- **Ollama** (vía `@langchain/ollama` / `ChatOllama`): modelo local.
- **@langchain/langgraph** (`StateGraph`): motor que ejecuta el grafo compilado.
- **GitHub Releases API**: consulta de versión nueva.

## Flujo de la user story testigo

**Generar:** `ExecutionChatPanel.tsx` → `useExecutionWorkspace.ts` → `generateExecution.ts` → (HTTP + SSE) → `router.ts` → `generate-execution.ts` → `generate-graph.ts` (fase 1: esqueleto con `topology-compiler.ts` contra Ollama; fase 2: `node-configuration.ts`) → eventos `planning` / `node_added` / `edge_added` por SSE de vuelta al canvas → `execution-repository.ts` guarda el grafo en SQLite.

**Correr:** `RunExecutionModal.tsx` → `runExecutionStream.ts` → `router.ts` → `run-execution.ts` → `compiler.ts` (compila a LangGraph) → nodos `plugin` vía `plugin-node-executor.ts` → `hive-microkernel.ts` → plugin; nodos `llm` vía `llm-executor.ts` → Ollama → `result-normalizer.ts` → se guarda en `execution_history` y se emite `done`.

## Responsabilidades

**ExecutionsMain.tsx:** pantalla principal de Ejecuciones. Compone canvas, chat, barra de corrida y resultado; no tiene lógica de negocio.

**useExecutionWorkspace.ts:** guarda el estado de cada ejecución por clave (generando, corriendo, grafo, nodo activo, logs, resultado) y orquesta los flujos SSE de generar y correr.

**visual-builder/:** dibuja el `LangGraphAbstraction` como canvas interactivo y traduce entre el modelo del backend y el de la UI.

**generateExecution.ts / runExecutionStream.ts:** clientes de la API que abren la conexión SSE y traducen cada evento en un callback tipado.

**executions/router.ts:** controller Hono. Parsea el request, aplica guardas y delega en un caso de uso.

**core/api/sse.ts:** abre la respuesta `text/event-stream`, entrega a cada caso de uso una función `send(evento, datos)` y cierra el stream.

**generate-execution.ts:** caso de uso de generación. Crea o recupera la ejecución, consume el generador de eventos y persiste el grafo final como versión nueva. Con `dryRun` previsualiza sin guardar.

**run-execution.ts:** caso de uso de corrida. Carga el último grafo, lo compila, retransmite los eventos de LangGraph, normaliza el resultado y registra la iteración. Aplica la política de aprobación humana.

**update-execution-graph.ts:** guarda ediciones manuales validando el grafo contra los plugins activos; uno inválido responde 400.

**generate-graph.ts y fases:** núcleo de IA. Genera el esqueleto (validado y reintentado), configura cada nodo y autocorrige interpolaciones, emitiendo eventos incrementales.

**validate-graph.ts:** valida el contrato del grafo (inicio/fin únicos, aristas, alcanzabilidad, ramas de condición, variables, parámetros de plugin) y devuelve violaciones tipificadas.

**compiler.ts:** traduce `LangGraphAbstraction` a un `StateGraph` de LangGraph, con el estado y sus reductores.

**llm-executor.ts:** ejecuta nodos LLM con salida estructurada y las herramientas habilitadas.

**plugin-node-executor.ts:** resuelve el `inputMapping` (`${variable}`) contra el estado, invoca la herramienta del microkernel y guarda el resultado en `outputKey`.

**result-normalizer.ts:** convierte el estado final en un resultado tipado (texto, tabla, archivo, error) renderizable por el frontend.

**hive-microkernel.ts:** registro central de plugins. Los registra, activa y desactiva, persiste su estado, expone `getTool(name)` y carga plugins externos en un subproceso.

**execution-repository.ts:** persistencia en tres tablas: `executions` (cabecera), `execution_graphs` (grafo versionado) y `execution_history` (resultado por iteración), con borrado en cascada.

**Ollama (tercero):** recibe todas las inferencias, de la generación y de los nodos LLM.

**@langchain/langgraph (tercero):** ejecuta el grafo compilado y emite los eventos de avance.

# HiveAI

Agente de IA de escritorio con arquitectura de plugins. Corre modelos localmente y se extiende con módulos reutilizables que funcionan igual con un modelo local o uno en la nube.

El problema que ataca no es el costo ni la privacidad: es que hoy todo lo que construís sobre una IA (MCPs, reglas, extensiones, conocimiento acumulado) queda atado al ecosistema cerrado de un único proveedor. HiveAI es la capa neutral que falta — construís una extensión una vez y la usás con el modelo que quieras, sin reescribirla.

> Trabajo Integrador de Programación — Universidad Nacional de Quilmes.

---

## Stack

- **Runtime:** Deno (Deno Desktop)
- **Frontend:** Vite + React
- **Estilos:** Tailwind CSS
- **Componentes:** shadcn/ui sobre Base UI, preset Nova
- **Grafos de agente:** LangGraph
- **Modelo local:** Ollama
- **Linting:** Oxlint en `frontend/`, `deno lint` nativo en `backend/`
- **Tests backend:** `deno test` nativo + `@std/assert`
- **Tests frontend:** Vitest + Testing Library (pendiente de instalar)

Deno se eligió sobre Node deliberadamente: su sistema de módulos por URL y caché global evita el `node_modules` por proyecto, lo que mantiene livianos los plugins exportados y simplifica la funcionalidad de export/import que viene más adelante.

---

## Requisitos

- [Deno](https://deno.com) instalado (`deno desktop` es experimental; verificá que tu versión lo incluya)
- [Ollama](https://ollama.com) corriendo localmente, con un modelo descargado

---

## Modo desarrollo (hot reload)

Para tener recarga en vivo de ambas partes de la aplicación al mismo tiempo, el entorno de desarrollo se levanta en dos terminales separadas. Desarrollaremos sobre el navegador web estándar, y empaquetaremos al final.

**1. Levantar el Backend (API)**
En una terminal, desde la raíz del proyecto, arranca el servidor de Deno con reinicio automático:
```bash
deno task dev
```
*(Esto levanta el backend en `http://localhost:8000` y observará los cambios en `main.ts` y la carpeta `backend/`)*.

**2. Levantar el Frontend (Vite)**
En otra terminal, entra a la carpeta del frontend y levanta Vite:
```bash
cd frontend
deno desktop --hmr .

```
*(Esto levanta el entorno de interfaz en `http://localhost:5173` con Hot Module Replacement (HMR) ultrarrápido).*

**3. Visualizar**
Abre tu navegador web en `http://localhost:5173`. Todos los cambios que hagas en React se reflejarán instantáneamente, y si cambias la lógica del backend, la API se reiniciará sola de fondo.

## Modo Producción (App de Escritorio)

Para generar el ejecutable nativo de la aplicación de escritorio, existe un script automatizado que unifica la construcción del frontend y empaqueta el backend en un binario independiente usando Deno.

Desde la raíz del proyecto (o desde la carpeta `backend/`), ejecuta:

```bash
deno task build:desktop
```

*(O puedes correr `./build-desktop.sh` directamente si estás en la raíz).*

Al finalizar, el ejecutable listo para usar se encontrará dentro de la carpeta `dist/` en la raíz del proyecto.

---

## Tests

El foco está en el backend: ahí vive la lógica de negocio (grafos de agentes, microkernel de plugins, use cases), mientras que el frontend es mayormente UI de gestión donde los bugs se notan a simple vista.

### Tests unitarios/integración (backend)

Corren con el test runner nativo de Deno, sin dependencias externas ni LLM real:
```bash
cd backend
deno task test
```

Para correr un solo archivo o carpeta:
```bash
deno test -A tests/unit/
deno test -A tests/unit/setPluginsActive.test.ts
```

**Ubicación — dos convenciones conviven:**
- `backend/tests/unit/` — carpeta central para tests de use cases, repositorios y flujos que cruzan varios módulos (ej. `PluginStateRepository.test.ts`, `HiveMicrokernel.pluginState.test.ts`, `setPluginsActive.test.ts`, `pluginsRouter.batchActive.test.ts`).
- Archivos `nombre.test.ts` junto al módulo, para lo que es puramente local a ese archivo:
  - `core/ai/strategy/scout/agent/prompt.test.ts` — funciones puras (prompts), sin mocks.
  - `plugins/counter/index.test.ts` — un plugin probado en aislamiento, con un `BeeContext` fake apuntando a un directorio temporal (nunca toca `~/.hiveai` real).
  - `modules/plugins/router.test.ts` — un endpoint Hono probado con `app.request()`.

Al agregar un test nuevo: si prueba un solo archivo aislado, va al lado del archivo; si cruza módulos (microkernel + repo + router, por ejemplo), va a `tests/unit/`.

**Mockear el LLM:** cualquier test que pase por un nodo del grafo (`ChatOllama`, `Scout.stream`, etc.) debe mockear la respuesta del modelo — no depender de que Ollama esté corriendo. El LLM es no determinístico y lento; lo que se testea acá es que el grafo/routing reaccione bien a una respuesta dada, no la calidad de esa respuesta. Para eso está el eval de LLM (ver abajo).

**Cuidado con los singletons:** `HiveMicrokernel` y el cliente de la base de datos (`infrastructure/db/orm.ts`) son singletons de proceso. Para tests, instanciá tu propio `new HiveMicrokernel()` en vez de `HiveMicrokernel.getInstance()`, y apuntá `dataDir`/`configDir` a un `Deno.makeTempDir()` — así los tests no interfieren entre sí ni tocan datos reales del usuario. Excepción: `initORM()` también es singleton de proceso, así que varios tests en el mismo archivo terminan compartiendo la misma DB temporal — usá nombres únicos por test para no pisarte con otros tests del mismo archivo.

### Cobertura (coverage)

```bash
cd backend
deno task test:coverage
```

Corre toda la suite instrumentada y genera un reporte HTML navegable en `backend/coverage_profile/html/index.html` (abrilo directo en el navegador). También deja un `lcov.info` por si se quiere integrar con una herramienta externa (Codecov, extensión de VS Code, etc.). La carpeta `coverage_profile/` no se commitea (está en `.gitignore`) porque es output regenerable.

Dos números por archivo: **líneas** (qué porcentaje del código se ejecutó al menos una vez) y **ramas** (qué porcentaje de los `if`/`switch`/ternarios se ejecutó en todos sus caminos). Es normal que ramas quede más bajo que líneas — significa que se prueba el camino feliz pero no todos los `catch`/edge cases.

### Eval de LLM (routing/abstención de plugins)

Distinto a los tests de arriba: **no es determinístico y no es un gate de CI**. Corre el grafo `Scout` completo contra un modelo real de Ollama para medir si el LLM elige el plugin correcto, se abstiene cuando corresponde, y extrae bien los parámetros — cosas que no se pueden probar mockeando el modelo.

```bash
cd backend
deno task eval:llm            # usa qwen3:8b por default
deno task eval:llm lfm2.5     # o cualquier modelo instalado en Ollama
```

Requiere Ollama corriendo con un modelo de tool-calling ya descargado (`ollama pull qwen3:8b`); si el modelo pedido no está instalado, el script lo reporta como `SKIPPED` en vez de fallar. Tarda varios minutos (cada caso es una invocación real al modelo).

Los casos viven en `backend/tests/llm-eval/cases.ts` (routing, abstención, extracción de parámetros — fácil de extender agregando entradas al array). El runner (`run.ts`) imprime resultado por caso y un resumen de **pass rate por categoría** al final — un 8/10 puntual no es necesariamente una regresión (varianza propia del modelo), pero una caída sostenida sí es señal de que algo se rompió (un prompt, una descripción de plugin ambigua, etc.). Correrlo manualmente antes de tocar prompts del Agent/Executor o descripciones de plugins, no en cada commit.

**Frontend:** todavía no está instalado (ver stack arriba). Cuando se agregue, el criterio es testear lógica en `src/features/*/lib/`, `src/features/*/api/`, `src/hooks/` y `src/lib/`, no snapshots de UI.

---

## Estructura del proyecto y convenciones

### Backend (`backend/`)
```
main.ts                 entrada (la usan build-desktop.sh y deno.json)
bootstrap/              arranque: create-app.ts, desktop.ts, load-plugins.ts
core/                   plataforma transversal, sin lógica de features
  api/ ollama/ files/ memory/ microkernel/ ai/ env.ts
modules/<feature>/      un slice por feature: router.ts, types.ts, use-cases/, lib/
infrastructure/db/      orm, schema/, repositories/, migrations/
plugins/                plugins incluidos (cada uno con su bee-plugin.ts)
config/  experiments/
```
- Archivos y carpetas en `kebab-case` (`send-message.ts`, `use-cases/`); las clases dentro siguen en PascalCase.
- Un caso de uso es un archivo con su nombre (`use-cases/send-message.ts`); solo tiene carpeta si necesita archivos auxiliares (`run-execution/run-execution.ts` + `plugin-node-executor.ts`).
- Tests: junto al archivo si prueban algo local (`send-message.test.ts`), o en `tests/unit/` si cruzan módulos. Sin `index.ts` en el backend.

### Frontend (`frontend/src/`)
```
features/<feature>/     chats, drafts, executions, interactions, models, modes, plugins
  api/ components/ hooks/ lib/ types.ts   (+ Contexto.tsx si hay)
components/             ui/ (shadcn) y componentes compartidos de la app
hooks/                  hooks compartidos (useCopyFeedback, useKeyedState...)
lib/                    infraestructura (apiClient, sse, toastManager...) y utils.ts de shadcn
```
- Componentes `PascalCase.tsx`; hooks `useAlgo.ts`; el resto `camelCase.ts`. `components/ui/` y `lib/utils.ts` mantienen su nombre por shadcn.
- Las features usan los mismos nombres que los módulos del backend.
- Una feature no importa los componentes internos de otra salvo a través de su `types.ts`, su `api/` o su `index.ts` raíz.

---

## Contribuir

Antes de escribir UI, leé [`frontend/DESIGN.md`](frontend/DESIGN.md). No es opcional: define los tokens de color, la tipografía y las convenciones de componentes que mantienen la interfaz coherente entre varias personas.

Convenciones rápidas:

- Un componente por archivo, carpeta por componente, PascalCase.
- Props tipadas explícitamente con una interfaz `ComponenteProps`. Nada de `any`.
- Tipos compartidos en `frontend/types/`, no duplicados.
- `components/ui/` lo genera el CLI de shadcn — no lo edites a mano.
- Antes de instalar una dependencia nueva, preguntá. El bundle que embebe `deno desktop` ya supera los 250MB y cada agregado lo paga el usuario final en el instalador.
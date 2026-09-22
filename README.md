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

**Backend** — corre con el test runner nativo de Deno, sin dependencias externas:
```bash
cd backend
deno task test
```
Convención: un archivo `nombre.test.ts` junto al módulo que testea (no una carpeta `tests/` separada). Los tests viven cerca del código:
- `core/ai/strategy/SCOUT/agent/prompt.test.ts` — funciones puras (prompts), sin mocks.
- `plugins/counter/index.test.ts` — un plugin probado en aislamiento, con un `BeeContext` fake apuntando a un directorio temporal (nunca toca `~/.hiveai` real).
- `modules/plugins/router.test.ts` — un endpoint Hono probado con `app.request()`, montando una instancia propia de `HiveMicrokernel` (no el singleton global) para no pisar estado entre tests.

**Mockear el LLM:** cualquier test que pase por un nodo del grafo (`ChatOllama`, `Scout.stream`, etc.) debe mockear la respuesta del modelo — no depender de que Ollama esté corriendo. El LLM es no determinístico y lento; lo que se testea es que el grafo/routing reaccione bien a una respuesta dada, no la calidad de esa respuesta.

**Cuidado con los singletons:** `HiveMicrokernel` y el cliente de la base de datos (`infrastructure/db/orm.ts`) son singletons de proceso. Para tests, instanciá tu propio `new HiveMicrokernel()` en vez de `HiveMicrokernel.getInstance()`, y apuntá `dataDir` a un `Deno.makeTempDir()` — así los tests no interfieren entre sí ni tocan datos reales del usuario.

**Frontend:** todavía no está instalado (ver stack arriba). Cuando se agregue, el criterio es testear lógica en `src/context/` y `src/lib/`, no snapshots de UI.

---

## Contribuir

Antes de escribir UI, leé [`frontend/DESIGN.md`](frontend/DESIGN.md). No es opcional: define los tokens de color, la tipografía y las convenciones de componentes que mantienen la interfaz coherente entre varias personas.

Convenciones rápidas:

- Un componente por archivo, carpeta por componente, PascalCase.
- Props tipadas explícitamente con una interfaz `ComponenteProps`. Nada de `any`.
- Tipos compartidos en `frontend/types/`, no duplicados.
- `components/ui/` lo genera el CLI de shadcn — no lo edites a mano.
- Antes de instalar una dependencia nueva, preguntá. El bundle que embebe `deno desktop` ya supera los 250MB y cada agregado lo paga el usuario final en el instalador.
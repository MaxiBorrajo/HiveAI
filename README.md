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
- **Tests:** Vitest + Testing Library

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

---

## Contribuir

Antes de escribir UI, leé [`frontend/DESIGN.md`](frontend/DESIGN.md). No es opcional: define los tokens de color, la tipografía y las convenciones de componentes que mantienen la interfaz coherente entre varias personas.

Convenciones rápidas:

- Un componente por archivo, carpeta por componente, PascalCase.
- Props tipadas explícitamente con una interfaz `ComponenteProps`. Nada de `any`.
- Tipos compartidos en `frontend/types/`, no duplicados.
- `components/ui/` lo genera el CLI de shadcn — no lo edites a mano.
- Antes de instalar una dependencia nueva, preguntá. El bundle que embebe `deno desktop` ya supera los 250MB y cada agregado lo paga el usuario final en el instalador.
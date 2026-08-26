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

Para levantar el proyecto y ver los cambios en tiempo real, ubicate en `frontend/` y ejecutá el entorno de desarrollo de Deno Desktop:

```bash
cd frontend
deno desktop --hmr .
```

Esto levanta el servidor de Vite con **Hot Module Replacement (HMR)** y abre automáticamente la ventana de la aplicación de escritorio. Cuando edites componentes React, lógica o estilos, los cambios se reflejan al instante sin reiniciar.

El comando corre desde `frontend/` aunque también cargue el backend: `server.ts` resuelve esa importación.

## Generar el ejecutable (build)

Para compilar la aplicación y producir un binario listo para distribuir:

```bash
cd frontend
deno desktop build .
```

Usa la configuración de `deno.json`, empaquetando el frontend y el motor web configurado (`webview` o `cef`).

---

## Contribuir

Antes de escribir UI, leé [`frontend/DESIGN.md`](frontend/DESIGN.md). No es opcional: define los tokens de color, la tipografía y las convenciones de componentes que mantienen la interfaz coherente entre varias personas.

Convenciones rápidas:

- Un componente por archivo, carpeta por componente, PascalCase.
- Props tipadas explícitamente con una interfaz `ComponenteProps`. Nada de `any`.
- Tipos compartidos en `frontend/types/`, no duplicados.
- `components/ui/` lo genera el CLI de shadcn — no lo edites a mano.
- Antes de instalar una dependencia nueva, preguntá. El bundle que embebe `deno desktop` ya supera los 250MB y cada agregado lo paga el usuario final en el instalador.
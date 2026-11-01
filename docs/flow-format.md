# Formato de archivo de flujo (`hiveai-flow`)

Archivo `.hiveai-flow.zip` autocontenido para exportar/importar una ejecución entre instalaciones de HiveAI. El usuario exporta un zip e importa un zip; el resto ocurre por detrás.

## Estructura (versión 2)

```
mi-flujo.hiveai-flow.zip
├─ flow.json                      # grafo y metadatos
└─ plugins/<nombre>/index.ts      # una carpeta por plugin externo requerido (+ otros .ts auxiliares)
```

**`bee-plugin.ts` nunca viaja en el zip.** La interfaz `BeePlugin` es siempre la de la instalación que importa (`backend/core/microkernel/bee-plugin.ts`); si el zip trae un `bee-plugin.ts` se ignora.

`flow.json`:

```json
{
  "format": "hiveai-flow",
  "formatVersion": 2,
  "kind": "execution",
  "exportedAt": "2026-10-28T12:00:00.000Z",
  "name": "Mi flujo",
  "graph": { "nodes": [], "edges": [], "stateSchema": {} },
  "orchestrator": { "provider": "ollama", "model": "llama3" },
  "requiredPlugins": [{ "name": "web-search", "external": false }]
}
```

| Campo | Descripción |
|---|---|
| `format` | Siempre `"hiveai-flow"`. |
| `formatVersion` | Entero. Esta versión de HiveAI solo acepta `2` (los `.hiveai-flow.json` de la versión 1 hay que reexportarlos). |
| `kind` | `"execution"`. Reservado para soportar otros tipos de flujo. |
| `name` | Nombre de la ejecución. |
| `graph` | Nodos, conexiones y `stateSchema`, igual que el grafo guardado por el editor. |
| `orchestrator` | Proveedor y modelo, sin `keyId`. Puede ser `null`. |
| `requiredPlugins` | Plugins referenciados por los nodos; `external` indica si son importados. |

## Qué NO se exporta

- API keys, valores de configuración de plugins ni ningún secreto: `keyId` se elimina de cada nodo y del orquestador.
- Historial de corridas, resultados, ids de base de datos.
- Archivos de plugin que no sean `.ts`, y `bee-plugin.ts`.

Aviso: `systemPrompt`, `inputMapping`, etc. son texto libre y se exportan tal cual. HiveAI advierte si algún campo parece contener un secreto (patrones como `sk-…`, `Bearer …`, `AKIA…`), pero no lo modifica.

## Reglas de importación

1. El archivo se rechaza con un mensaje claro si no es un zip válido, no tiene `flow.json`, no es JSON válido, está incompleto, no es `hiveai-flow` o tiene una `formatVersion` no soportada.
2. El grafo se valida con las mismas reglas que un flujo creado a mano (`validateGraph`). Si hay violaciones no se importa nada.
3. Plugins:
   - Si ya hay un plugin instalado con el mismo nombre, se usa el local y nunca se sobrescribe.
   - Los plugins incluidos que faltan se instalan solo si el usuario lo confirma (ejecutan código).
   - Antes de instalar (y también en la vista previa) cada plugin se type-checkea contra la interfaz `BeePlugin` local. Si no coincide, se muestra el error del compilador, no se puede instalar y la importación del flujo continúa como borrador.
   - Si tras el import falta algún plugin, el flujo queda como **borrador**: se guarda, se informa cuáles faltan y no se puede ejecutar (422) hasta instalarlos.
   - Los plugins instalados pero inactivos solo se informan; no se activan solos.
4. Si ya existe una ejecución con ese nombre, hay que elegir explícitamente "copia nueva" (`X (imported)`) o "reemplazar" (agrega una versión nueva al grafo y pide una segunda confirmación). Sin elección, la API responde 409 y no cambia nada.

## Compatibilidad

Cambios que no rompen lectura (campos opcionales nuevos) no suben `formatVersion`. Cualquier cambio incompatible incrementa la versión y requiere un migrador explícito para las versiones anteriores.

## API

- `GET /api/executions/:id/export[?confirmSecrets=1]` → guarda el zip en Descargas y responde `{ saved, path, secretWarnings }`. Si hay posibles secretos y no se pasó `confirmSecrets`, responde `saved: false` sin escribir nada.
- `POST /api/executions/import/preview` (multipart, campo `file` con el zip) → plugins faltantes/inactivos, `conformanceIssues` por plugin incluido, conflicto de nombre, violaciones. No escribe.
- `POST /api/executions/import` (multipart: `file`, `conflict?: "new"|"overwrite"`, `installBundledPlugins?: string` con un array JSON de nombres).

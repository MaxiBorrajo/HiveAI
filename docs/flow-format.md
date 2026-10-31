# Formato de archivo de flujo (`hiveai-flow`)

Archivo JSON autocontenido para exportar/importar una ejecución entre instalaciones de HiveAI. Extensión sugerida: `.hiveai-flow.json`.

## Estructura (versión 1)

```json
{
  "format": "hiveai-flow",
  "formatVersion": 1,
  "kind": "execution",
  "exportedAt": "2026-10-28T12:00:00.000Z",
  "name": "Mi flujo",
  "graph": { "nodes": [], "edges": [], "stateSchema": {} },
  "orchestrator": { "provider": "ollama", "model": "llama3" },
  "requiredPlugins": [{ "name": "web-search", "external": false }],
  "bundledPlugins": [
    { "name": "mi-plugin", "files": { "index.ts": "...", "bee-plugin.ts": "..." } }
  ]
}
```

| Campo | Descripción |
|---|---|
| `format` | Siempre `"hiveai-flow"`. |
| `formatVersion` | Entero. Esta versión de HiveAI solo acepta `1`. |
| `kind` | `"execution"`. Reservado para soportar otros tipos de flujo. |
| `name` | Nombre de la ejecución. |
| `graph` | Nodos, conexiones y `stateSchema`, igual que el grafo guardado por el editor. |
| `orchestrator` | Proveedor y modelo, sin `keyId`. Puede ser `null`. |
| `requiredPlugins` | Plugins referenciados por los nodos; `external` indica si son importados. |
| `bundledPlugins` | Código fuente (`.ts`, nombres planos) de los plugins externos requeridos. |

## Qué NO se exporta

- API keys, valores de configuración de plugins ni ningún secreto: `keyId` se elimina de cada nodo y del orquestador.
- Historial de corridas, resultados, ids de base de datos.
- Archivos de plugin que no sean `.ts`.

Aviso: `systemPrompt`, `inputMapping`, etc. son texto libre y se exportan tal cual. HiveAI advierte si algún campo parece contener un secreto (patrones como `sk-…`, `Bearer …`, `AKIA…`), pero no lo modifica.

## Reglas de importación

1. El archivo se rechaza con un mensaje claro si no es JSON válido, está incompleto, no es `hiveai-flow` o tiene una `formatVersion` no soportada.
2. El grafo se valida con las mismas reglas que un flujo creado a mano (`validateGraph`). Si hay violaciones no se importa nada.
3. Plugins:
   - Si ya hay un plugin instalado con el mismo nombre, se usa el local y nunca se sobrescribe.
   - Los plugins incluidos que faltan se instalan solo si el usuario lo confirma (ejecutan código).
   - Si tras el import falta algún plugin, el flujo queda como **borrador**: se guarda, se informa cuáles faltan y no se puede ejecutar (422) hasta instalarlos.
   - Los plugins instalados pero inactivos solo se informan; no se activan solos.
4. Si ya existe una ejecución con ese nombre, hay que elegir explícitamente "copia nueva" (`X (imported)`) o "reemplazar" (agrega una versión nueva al grafo y pide una segunda confirmación). Sin elección, la API responde 409 y no cambia nada.

## Compatibilidad

Cambios que no rompen lectura (campos opcionales nuevos) no suben `formatVersion`. Cualquier cambio incompatible incrementa la versión y requiere un migrador explícito para las versiones anteriores.

## API

- `GET /api/executions/:id/export` → `{ filename, file, secretWarnings }`
- `POST /api/executions/import/preview` `{ file }` → plugins faltantes/inactivos, conflicto de nombre, violaciones. No escribe.
- `POST /api/executions/import` `{ file, conflict?: "new"|"overwrite", installBundledPlugins?: string[] }`

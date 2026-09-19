#!/bin/bash
set -e

# Obtener la ruta absoluta del directorio donde está este script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔨 Construyendo el Frontend..."
cd "$DIR/frontend"
deno install
deno task build

echo "🔨 Empaquetando la aplicación de Escritorio con Deno..."
cd "$DIR/backend"
deno install
deno desktop -A --include plugins --include ../frontend/dist main.ts

echo "✅ ¡Build finalizado! El ejecutable se encuentra en la nueva carpeta 'dist/' en la raíz (dist/hive-ai)"

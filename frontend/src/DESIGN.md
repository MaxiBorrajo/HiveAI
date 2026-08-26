# HiveAI — Guía de diseño

Documento de referencia para cualquiera que escriba UI en `frontend/`. No es una guía de estilo aspiracional: son las reglas que mantienen la identidad estable cuando el código lo toca más de una persona.

Si algo no está acá, preguntá antes de inventar un token.

---

## Contexto

HiveAI es una app de escritorio para desarrolladores que corre un modelo de IA local. El usuario la deja abierta durante horas, en pantalla completa, mientras trabaja en otra cosa. Eso determina casi todas las decisiones de abajo: densidad alta, fondo oscuro, color escaso.

**Dark-first, no dark-mode.** El modo oscuro es el producto. El tema claro existe porque los tokens de shadcn lo requieren, pero no es el caso de uso que optimizamos. `<html class="dark">` está fijo en `index.html`.

---

## 1. Color

### La regla

Nunca escribas una escala cruda de Tailwind. Ni `bg-zinc-900`, ni `text-amber-400`, ni `border-neutral-800`.

Todo color sale de un token semántico:

| Uso | Token |
|---|---|
| Fondo de la app | `bg-background` |
| Fondo de tarjeta / panel elevado | `bg-card` |
| Texto principal | `text-foreground` |
| Texto secundario, labels, timestamps | `text-muted-foreground` |
| Bordes y divisores | `border-border` |
| Fondo de input | `bg-input` |
| Anillo de foco | `ring-ring` |
| Acento del agente | `text-primary` / `bg-primary` |
| Error | `text-destructive` / `bg-destructive` |

Si necesitás un color que ningún token cubre, el problema es el diseño, no el token. Traelo a discusión en vez de hardcodear un hex.

### El ámbar es del agente

`primary` no es "el color lindo de la marca para resaltar cosas". Representa la presencia de la IA. Se usa únicamente en:

- Mensajes de HiveQueen (avatar, indicador)
- Plugin ejecutándose o seleccionado
- Estado activo de un nodo
- El punto del logo

Un botón de "Cancelar", un link de ayuda o un badge de versión **no llevan ámbar**. Si dudás, no lo lleva.

Consecuencia directa: **no hay warnings amarillos.** Un estado de advertencia se comunica con borde e icono, no con color. El único estado que usa color propio es el error, con `destructive`. Si aparece un toast amarillo en algún lado, se pisa con la identidad del agente y hay que sacarlo.

### Base cálida

Los neutros están tintados hacia el cálido (cera, propóleo), no hacia el azul. Es la diferencia entre esto y cualquier dashboard genérico. No mezcles grises fríos de Tailwind con los tokens; se nota inmediatamente.

---

## 2. Tipografía

Dos familias, tres tamaños. Más que eso es ruido.

### Familias

**Archivo** (`font-sans`) — todo el texto de interfaz y de conversación.

**JetBrains Mono** (`font-mono`) — territorio de máquina. Esto no es decorativo: la fuente monoespaciada marca lo que el sistema ejecuta o identifica, no lo que dice.

Va en mono:
- Nombres de plugin (`FileSearchPlugin`)
- Comandos shell y su salida
- Rutas de archivo
- Estados de nodo, IDs, valores técnicos

No va en mono:
- Prosa, ni siquiera la del agente
- Labels de botones
- Mensajes de error dirigidos al usuario

### Los imports son específicos y no se tocan

Ambas familias se cargan self-hosted vía Fontsource, importadas al principio de `src/index.css`:

```css
@import "@fontsource-variable/archivo/standard.css";
@import "@fontsource-variable/jetbrains-mono/latin.css";
```

**`standard.css` en Archivo no es intercambiable por `wght.css`.** Fontsource publica los ejes por separado: `wght.css` trae solo peso, `standard.css` trae peso y ancho (`font-stretch: 62% 125%`). Si alguien lo cambia a `wght.css` para ahorrar unos KB, `text-display` deja de funcionar sin dar ningún error — simplemente se ve igual que el texto normal. Verificado sobre el paquete instalado.

**Nunca agregues una fuente por CDN de Google.** La app corre offline; un link externo la rompe sin red y filtra una request en cada arranque, lo cual contradice la premisa del producto.

Solo estas dos familias. Si el preset de shadcn arrastra una tercera (Geist, por ejemplo), sacala: `--font-sans` ya apunta a Archivo, así que sería peso muerto en el binario.

### Escala

| Rol | Clase | Uso |
|---|---|---|
| Sistema | `text-xs font-mono` | Labels, nombres de plugin, timestamps |
| Cuerpo | `text-sm` | Mensajes del chat, texto general |
| Entrada | `text-base` | Solo el input del chat |
| Display | `text-display text-lg` | Wordmark, títulos de sección |

`text-sm` para el cuerpo es deliberado: la app es densa y 16px desperdicia altura vertical en una ventana de escritorio.

### El display

`text-display` está declarado como utility de Tailwind en `index.css`:

```css
@utility text-display {
  font-stretch: 118%;
  font-weight: 600;
  letter-spacing: -0.02em;
}
```

Usa el eje de ancho variable de Archivo. Es el único lugar donde la tipografía llama la atención sobre sí misma: se reserva para el wordmark y encabezados de sección, no para enfatizar dentro de un párrafo.

Está como `@utility` y no como clase suelta a propósito. Una clase fuera de capas gana contra las utilities de Tailwind por precedencia de cascade layers, así que `className="text-display font-normal"` ignoraría el `font-normal` sin explicación visible. Como utility, se comporta como cualquier otra y se puede sobrescribir.

---

## 3. Logo

El hexágono está **abierto de un lado, con un nodo saliendo por la abertura**.

Eso no es un detalle gráfico: es la propuesta de valor del producto. La celda cerrada dice "colmena". La celda abierta con algo que sale dice "lo que construís acá se lo puede llevar a otro lado". Es el argumento contra el lock-in, dibujado.

Reglas de uso:

- Se usa desde `@/components/Logo`. No copies el SVG a otro archivo.
- El trazo hereda `currentColor`; el punto es siempre `fill-primary`.
- No lo pongas sobre fondos de color. Va sobre `background` o `card`.
- No lo rotes, no lo cierres, no le agregues más nodos.
- Tamaño mínimo: 20px. Por debajo la abertura deja de leerse y pierde todo el sentido.

El favicon en `public/` es el mismo trazo con los colores hardcodeados (`#F5EDE0` y `#E8A33D`), porque ahí no hay tokens disponibles.

---

## 4. Componentes

### Dos carpetas, dos reglas

**`components/ui/`** — generado por el CLI de shadcn. No lo edites a mano salvo que estés seguro de que nunca vas a volver a correr `shadcn add` sobre ese archivo, porque lo pisa sin avisar. Si necesitás una variante nueva de un componente, envolvelo en uno propio.

**`components/NombreDelComponente/`** — nuestros componentes. Carpeta por componente:

```
components/ChatWindow/
├── ChatWindow.tsx
└── index.ts
```

PascalCase, uno por archivo, props tipadas explícitamente con una interfaz `ChatWindowProps`. Nada de `any`.

Los tipos compartidos van en `frontend/types/`, no duplicados en cada componente. El tipo `Message` vive en `types/chat.ts`.

### Antes de instalar un componente nuevo

El binario final embebe `dist/` completo. Hoy son unos cientos de KB y arranca instantáneo; cada dependencia que no se usa lo empeora para quien descarga el instalador.

Preguntá antes de agregar. En particular, no instales `form`, `table`, `select` ni `command` mientras no haya formularios reales ni datos tabulares.

---

## 5. Estado y estructura

- Estado local con `useState`. No hay Redux ni Zustand: el chat es de sesión, no persiste nada en el sprint 1.
- Sin librería de formularios. El input del chat es el único "formulario" y se maneja a mano.
- Tests con Vitest + Testing Library.
- Sin CSS-in-JS en runtime. Todo Tailwind.

Cuando aparezca persistencia o estado compartido entre vistas, revisamos. No antes.

---

## 6. Piso de calidad

No son extras, son requisitos de cualquier componente que se mergea:

- **Foco visible por teclado.** No saques el `ring` de los componentes de shadcn.
- **`prefers-reduced-motion` respetado** en cualquier animación.
- **Estados vacíos que invitan a actuar**, no que informan que no hay nada. Un chat vacío sugiere qué preguntar.
- **Errores que dicen qué pasó y qué hacer.** No se disculpan, no son vagos. "El plugin no pudo leer la ruta" sirve; "Algo salió mal" no.
- **Voz activa en los controles.** El botón dice exactamente qué pasa al apretarlo. Un botón que dice "Ejecutar" produce un mensaje que dice "Ejecutado", no "Enviado".
- **Sentence case** en toda la interfaz. Ni Title Case ni MAYÚSCULAS.

---

## 7. Qué hacer cuando dudás

1. ¿El color existe como token? Si no, no lo uses.
2. ¿Es texto que el sistema ejecuta o identifica? Mono. ¿Es texto que alguien lee? Sans.
3. ¿El elemento representa a la IA o a un plugin activo? Puede llevar ámbar. Si no, no.
4. ¿Estás por instalar algo? Preguntá.

---

## Deuda conocida

- `standard.css` de Archivo incluye el subset vietnamita y las variantes itálicas, que no usamos. No existe un archivo que combine ambos ejes y solo latin, así que recortarlo requiere declarar el `@font-face` a mano. Son unos 13KB: se hace cuando se pula el instalador, no antes.
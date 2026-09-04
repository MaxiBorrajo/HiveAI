export const TOOL_CALLING_PROMPT = `Elegí del catálogo la herramienta que resuelve el pedido del usuario e invocala con los parámetros correctos.
Si ninguna lo resuelve, no invoques nada y respondé únicamente: NONE`;

export const SELECTOR_PROMPT = `Elegí del catálogo la herramienta que resuelve el pedido del usuario.
Si ninguna lo resuelve, devolvé NONE.`;

export const PARAMETRIZADOR_PROMPT = `Completá los parámetros de la herramienta seleccionada a partir del pedido del usuario.
Extraé los valores de lo que el pedido dice o implica. No inventes valores.`;

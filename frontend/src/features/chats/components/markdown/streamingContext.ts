import { createContext } from "react";

/**
 * Offset in the text where a code block still being written begins, or null.
 * That block is shown as plain code until its closing fence arrives, so a
 * half-written diagram or drawing is not rendered.
 */
export const OpenBlockContext = createContext<number | null>(null);

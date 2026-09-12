export const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8000");

export interface ResponseEntity<T = unknown> {
  success: boolean;
  data?: T;
  errors?: string[];
}

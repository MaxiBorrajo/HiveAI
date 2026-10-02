export const API_URL = import.meta.env.PROD
  ? ""
  : import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface ResponseEntity<T = unknown> {
  success: boolean;
  data?: T;
  errors?: string[];
}

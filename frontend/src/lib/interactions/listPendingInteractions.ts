import { API_URL } from "../config";
import type { PendingInteraction } from "./types";

export async function listPendingInteractions(): Promise<PendingInteraction[]> {
  const response = await fetch(`${API_URL}/api/interactions`);
  return response.json();
}


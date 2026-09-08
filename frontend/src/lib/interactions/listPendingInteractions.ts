import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { PendingInteraction } from "./types.ts";

export async function listPendingInteractions(): Promise<ResponseEntity<PendingInteraction[]>> {
  const response = await axios.get(`${API_URL}/api/interactions`);
  return response.data;
}

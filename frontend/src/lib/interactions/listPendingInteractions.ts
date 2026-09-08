import axios from "axios";
import { API_URL } from "../config";
import type { PendingInteraction } from "./types";

export async function listPendingInteractions(): Promise<PendingInteraction[]> {
  const response = await axios.get(`${API_URL}/api/interactions`);
  console.log(response.data)
  return response.data;
}

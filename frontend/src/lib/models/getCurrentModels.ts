import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { CurrentModels } from "@/types/model";

export async function getCurrentModels(): Promise<
  ResponseEntity<CurrentModels>
> {
  const response = await axios.get(`${API_URL}/api/models/current`);
  return response.data;
}

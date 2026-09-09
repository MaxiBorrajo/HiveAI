import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { CurrentModels } from "@/types/model";

export async function setModels(
  patch: Partial<CurrentModels>,
): Promise<ResponseEntity<CurrentModels>> {
  const response = await axios.put(`${API_URL}/api/models/current`, patch);
  return response.data;
}

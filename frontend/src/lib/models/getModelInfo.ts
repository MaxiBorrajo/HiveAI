import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { ModelInfo } from "@/types/model";

export async function getModelInfo(
  name: string,
): Promise<ResponseEntity<ModelInfo>> {
  const response = await axios.get(
    `${API_URL}/api/models/${encodeURIComponent(name)}`,
  );
  return response.data;
}

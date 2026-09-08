import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { ChatMode } from "@/types/chat";

export async function setMode(mode: ChatMode): Promise<ResponseEntity<string>> {
  const response = await axios.put(`${API_URL}/api/modes`, mode);
  return response.data;
}

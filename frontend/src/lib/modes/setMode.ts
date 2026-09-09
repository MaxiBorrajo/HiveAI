import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";
import type { ChatMode } from "@/types/chat";

export async function setMode(
  mode: ChatMode,
): Promise<ResponseEntity<ChatMode[]>> {
  const { name, parameters } = mode;
  const response = await axios.put(`${API_URL}/api/modes`, {
    name,
    parameters,
  });
  return response.data;
}

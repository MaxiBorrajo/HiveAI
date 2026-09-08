import axios from "axios";
import { API_URL, type ResponseEntity } from "../config";

export async function saveTestResults(
  data: unknown,
): Promise<ResponseEntity<{ path: string }>> {
  const response = await axios.post(
    `${API_URL}/api/plugins/test-results`,
    data,
  );
  return response.data;
}

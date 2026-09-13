export interface ResponseEntity<T = unknown> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export class ResponseBuilder {
  static success<T>(data?: T, init?: ResponseInit): Response {
    const body: ResponseEntity<T> = { success: true, data };
    return Response.json(body, init);
  }

  static error<T>(errors: string[], data?: T, init?: ResponseInit): Response {
    const body: ResponseEntity<T> = { success: false, data, errors };
    return Response.json(body, init);
  }
}

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502;

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: HttpErrorStatus = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function parseId(raw: string | undefined, label = "id"): number {
  const id = Number(raw);
  if (!raw || !Number.isInteger(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
  return id;
}

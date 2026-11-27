import { ResponseBuilder } from "../../../core/api/response.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { RubricRepository } from "../../../infrastructure/db/repositories/rubric-repository.ts";
import { toRubricDto } from "../rubric-types.ts";

const MAX_RUBRIC_LENGTH = 20_000;

function failure(message: string, status: number, headers: Record<string, string>) {
  return ResponseBuilder.error([message], undefined, { headers, status });
}

export async function getRubric(
  db: AppDatabase,
  executionId: number,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    if (!(await new ExecutionRepository(db).findById(executionId))) {
      return failure("Execution not found", 404, headers);
    }
    const latest = await new RubricRepository(db).findLatest(executionId);
    return ResponseBuilder.success(
      { rubric: latest ? toRubricDto(latest) : null },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(`Failed to load the rubric: ${detail}`, 500, headers);
  }
}

/** Saves the rubric as a new version unless it is identical to the latest. */
export async function saveRubric(
  db: AppDatabase,
  executionId: number,
  body: { rubric?: unknown; reference?: unknown },
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const rubric = typeof body.rubric === "string" ? body.rubric.trim() : "";
    const reference =
      typeof body.reference === "string" && body.reference.trim()
        ? body.reference.trim()
        : null;
    if (!rubric) return failure("The rubric cannot be empty.", 400, headers);
    if (rubric.length > MAX_RUBRIC_LENGTH || (reference?.length ?? 0) > MAX_RUBRIC_LENGTH) {
      return failure(`The rubric is too long (max ${MAX_RUBRIC_LENGTH} characters).`, 400, headers);
    }
    if (!(await new ExecutionRepository(db).findById(executionId))) {
      return failure("Execution not found", 404, headers);
    }
    const repo = new RubricRepository(db);
    const latest = await repo.findLatest(executionId);
    const saved =
      latest && latest.rubric === rubric && latest.reference === reference
        ? latest
        : await repo.createVersion(executionId, rubric, reference);
    return ResponseBuilder.success({ rubric: toRubricDto(saved) }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(`Failed to save the rubric: ${detail}`, 500, headers);
  }
}

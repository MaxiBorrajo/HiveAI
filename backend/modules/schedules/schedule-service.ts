import { AppError } from "../../core/api/errors.ts";
import type { AppDatabase } from "../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../infrastructure/db/repositories/execution-repository.ts";
import { ScheduleRepository } from "../../infrastructure/db/repositories/schedule-repository.ts";
import type {
  Schedule,
  ScheduleFrequency,
} from "../../infrastructure/db/schema/schedules.ts";
import { parseMaybeJson } from "../executions/parse-maybe-json.ts";
import { computeNextRun, validateTiming } from "./lib/next-run.ts";

export interface ScheduleInput {
  frequency: ScheduleFrequency;
  /** HH:MM; daily and weekly only. */
  timeOfDay?: string;
  daysOfWeek?: number[];
  /** 5-field cron expression (frequency "cron"). */
  cron?: string;
  /** Fixed input for every run. */
  input?: string;
  enabled?: boolean;
}

const NEEDS_FIXED_INPUT =
  "This execution requires an input, and a schedule has nobody to type it. " +
  "Add a fixed input for the schedule to use on every run.";

type StateLookup =
  | { error: string }
  | { state: Record<string, { required?: boolean }> | null };

async function loadStateSchema(
  db: AppDatabase,
  executionId: number,
): Promise<StateLookup> {
  const repo = new ExecutionRepository(db);
  const execution = await repo.findById(executionId);
  if (!execution) return { error: "Execution not found." };
  if (!execution.lastGraphId) {
    return { error: "This execution has no graph yet." };
  }
  const graph = await repo.findGraphById(execution.lastGraphId);
  if (!graph) return { error: "This execution has no graph yet." };
  return {
    state: parseMaybeJson(graph.state) as
      | Record<string, { required?: boolean }>
      | null,
  };
}

/** Whether the graph insists on an `input` (the only thing a user types). */
export async function inputIsRequired(
  db: AppDatabase,
  executionId: number,
): Promise<boolean> {
  const loaded = await loadStateSchema(db, executionId);
  return "state" in loaded && loaded.state?.input?.required === true;
}

/**
 * A required input is fine as long as the schedule carries a fixed one;
 * without it there is nobody to supply it at 10:00.
 */
export async function whyNotSchedulable(
  db: AppDatabase,
  executionId: number,
  fixedInput: string,
): Promise<string | null> {
  const loaded = await loadStateSchema(db, executionId);
  if ("error" in loaded) return loaded.error;
  const required = loaded.state?.input?.required === true;
  return required && !fixedInput.trim() ? NEEDS_FIXED_INPUT : null;
}

function normaliseInput(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new AppError("Input must be text.", 400);
  return value.trim();
}

export function normalise(input: ScheduleInput) {
  const isCron = input.frequency === "cron";
  const timing = {
    frequency: input.frequency,
    // timeOfDay is NOT NULL in the table; a cron schedule just doesn't use it.
    timeOfDay: isCron ? "00:00" : input.timeOfDay ?? "",
    daysOfWeek: input.frequency === "weekly"
      ? [...new Set(input.daysOfWeek ?? [])].sort()
      : [],
    cron: isCron ? (input.cron ?? "").trim().split(/\s+/).join(" ") : "",
  };
  const problem = validateTiming(timing);
  if (problem) throw new AppError(problem, 400);
  return timing;
}

export async function createSchedule(
  db: AppDatabase,
  executionId: number,
  input: ScheduleInput,
): Promise<Schedule> {
  const timing = normalise(input);
  const fixedInput = normaliseInput(input.input);
  if ((await new ScheduleRepository(db).listByExecution(executionId)).length > 0) {
    throw new AppError(
      "This execution already has a schedule. Edit it instead.",
      409,
    );
  }
  const blocked = await whyNotSchedulable(db, executionId, fixedInput);
  if (blocked) {
    throw new AppError(
      blocked,
      blocked === "Execution not found." ? 404 : 422,
    );
  }
  const now = Date.now();
  return await new ScheduleRepository(db).create({
    executionId,
    ...timing,
    input: fixedInput,
    enabled: input.enabled ?? true,
    nextRunAt: computeNextRun(timing, now),
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateSchedule(
  db: AppDatabase,
  id: number,
  patch: Partial<ScheduleInput>,
): Promise<Schedule> {
  const repo = new ScheduleRepository(db);
  const current = await repo.findById(id);
  if (!current) throw new AppError("Schedule not found", 404);

  const timing = normalise({
    frequency: patch.frequency ?? current.frequency,
    timeOfDay: patch.timeOfDay ?? current.timeOfDay,
    daysOfWeek: patch.daysOfWeek ?? current.daysOfWeek,
    cron: patch.cron ?? current.cron,
  });
  const enabled = patch.enabled ?? current.enabled;
  const fixedInput = patch.input === undefined
    ? current.input
    : normaliseInput(patch.input);
  if (enabled) {
    const blocked = await whyNotSchedulable(
      db,
      current.executionId,
      fixedInput,
    );
    if (blocked) throw new AppError(blocked, 422);
  }

  // A resumed or retimed schedule starts counting from now: it must not
  // come back as a pile of "missed" slots from while it was paused.
  const retimed = patch.frequency !== undefined ||
    patch.timeOfDay !== undefined || patch.daysOfWeek !== undefined ||
    patch.cron !== undefined ||
    (enabled && !current.enabled);
  await repo.update(id, {
    ...timing,
    input: fixedInput,
    enabled,
    ...(retimed ? { nextRunAt: computeNextRun(timing, Date.now()) } : {}),
  });
  return (await repo.findById(id))!;
}

export async function deleteSchedule(
  db: AppDatabase,
  id: number,
): Promise<void> {
  const repo = new ScheduleRepository(db);
  if (!(await repo.findById(id))) throw new AppError("Schedule not found", 404);
  await repo.delete(id);
}

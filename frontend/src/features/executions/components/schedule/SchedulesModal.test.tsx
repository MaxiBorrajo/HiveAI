import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, type MockRoute } from "@/test-utils/mockApiClient";
import type { Schedule, ScheduleRun, SchedulesPayload } from "../../types";
import { SchedulesModal } from "./SchedulesModal";

const { mockApiClient } = vi.hoisted(() => ({
  mockApiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  },
}));

vi.mock("@/lib/apiClient", () => ({ apiClient: mockApiClient }));
vi.mock("@/lib/toastManager", () => ({ reportSuccess: vi.fn(), reportError: vi.fn() }));

const schedule: Schedule = {
  id: 5,
  executionId: 1,
  frequency: "daily",
  timeOfDay: "10:00",
  daysOfWeek: [],
  cron: "",
  input: "",
  enabled: true,
  nextRunAt: new Date(2026, 10, 8, 10).getTime(),
  lastRunAt: null,
};

const missed: ScheduleRun = {
  id: 9,
  scheduleId: 5,
  executionId: 1,
  scheduledFor: new Date(2026, 10, 7, 10).getTime(),
  status: "missed",
  historyId: null,
  missedCount: 2,
  error: null,
  acknowledged: false,
  startedAt: 0,
  finishedAt: 0,
};

let payload: SchedulesPayload;
let background = { launchAtLogin: true, runInBackground: true };

const PREVIEW: MockRoute = {
  method: "post",
  match: "/api/schedules/preview",
  handler: () => ok({ nextRuns: [Date.now() + 60000] }),
};

function setup(extra: MockRoute[] = []) {
  // The mock takes the first matching route, so a test's own routes go first.
  const real = createMockApiClient([
    ...extra,
    { method: "get", match: "/api/schedules/executions/1", handler: () => ok(payload) },
    { method: "get", match: "/api/app/background", handler: () => ok(background) },
    {
      method: "put",
      match: "/api/app/background",
      handler: (_path: unknown, patch: unknown) => {
        background = { ...background, ...(patch as object) };
        return ok(background);
      },
    },
    PREVIEW,
  ]);
  for (const m of ["get", "post", "put", "patch", "delete"] as const) {
    mockApiClient[m].mockImplementation(real[m]);
  }
}

function renderModal(props: Partial<Parameters<typeof SchedulesModal>[0]> = {}) {
  const onRunNow = vi.fn();
  render(
    <SchedulesModal
      open
      onOpenChange={() => {}}
      executionId="1"
      onRunNow={onRunNow}
      onChanged={() => {}}
      {...props}
    />,
  );
  return { onRunNow };
}

const click = (name: string | RegExp) =>
  userEvent.click(screen.getByRole("button", { name }));
const next = () => click("Next");
// The form checks with the backend after a 300ms pause; give a loaded machine room.
const SLOW = { timeout: 4000 };

async function startCreating() {
  await userEvent.click(await screen.findByRole("button", { name: /add schedule/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  payload = { schedules: [schedule], runs: [], inputRequired: false };
  background = { launchAtLogin: true, runInBackground: true };
});

describe("SchedulesModal list", () => {
  test("lists the schedule with its next run", async () => {
    setup();
    renderModal();
    expect(await screen.findByText("Every day at 10:00")).toBeInTheDocument();
    expect(screen.getByText(/Next run/)).toBeInTheDocument();
  });

  test("an execution with a schedule offers to edit it, not to add a second one", async () => {
    setup();
    renderModal();
    expect(await screen.findByLabelText("Edit schedule")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add schedule/i })).not.toBeInTheDocument();
  });

  test("pausing sends enabled=false", async () => {
    const patched = vi.fn(() => ok({ ...schedule, enabled: false }));
    setup([{ method: "patch", match: "/api/schedules/5", handler: patched }]);
    renderModal();
    await userEvent.click(await screen.findByLabelText("Pause schedule"));
    await waitFor(() => expect(patched).toHaveBeenCalled());
    expect(mockApiClient.patch).toHaveBeenCalledWith("/api/schedules/5", { enabled: false });
  });

  test("deleting asks for confirmation first", async () => {
    const removed = vi.fn(() => ok({ deleted: true }));
    setup([{ method: "delete", match: "/api/schedules/5", handler: removed }]);
    renderModal();
    await userEvent.click(await screen.findByLabelText("Delete schedule"));
    expect(removed).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: /delete/i }));
    await waitFor(() => expect(removed).toHaveBeenCalled());
  });

  test("missed runs are announced and only re-run when the user says so", async () => {
    payload = { schedules: [schedule], runs: [missed], inputRequired: false };
    const dismissed = vi.fn(() => ok({ dismissed: true }));
    setup([{ method: "post", match: "/api/schedules/runs/9/dismiss", handler: dismissed }]);
    const { onRunNow } = renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent(/not.*run automatically/i);
    expect(onRunNow).not.toHaveBeenCalled();

    await click("Run now");
    await waitFor(() => expect(onRunNow).toHaveBeenCalledTimes(1));
    expect(dismissed).toHaveBeenCalled();
  });
});

describe("SchedulesModal wizard", () => {
  test("with nothing else to ask: When -> warning -> Accept and schedule", async () => {
    const created = vi.fn(() => ok(schedule));
    payload = { schedules: [], runs: [], inputRequired: false };
    setup([{ method: "post", match: "/api/schedules/executions/1", handler: created }]);
    renderModal();
    await startCreating();

    expect(screen.getByText("When should it run?")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    const time = screen.getByLabelText("Time");
    await userEvent.clear(time);
    await userEvent.type(time, "07:45");
    await next();

    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/accepted without asking you/i);
    expect(created).not.toHaveBeenCalled();
    await click("Accept and schedule");

    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/schedules/executions/1",
      expect.objectContaining({ frequency: "daily", timeOfDay: "07:45", input: "" }),
    );
  });

  test("an execution that needs input gets an input step, and cannot skip it", async () => {
    const created = vi.fn(() => ok(schedule));
    payload = { schedules: [], runs: [], inputRequired: true };
    setup([{ method: "post", match: "/api/schedules/executions/1", handler: created }]);
    renderModal();
    await startCreating();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    await next();

    expect(screen.getByText("What should it receive?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Fixed input"), "summarise the news");
    await next();
    await click("Accept and schedule");

    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/schedules/executions/1",
      expect.objectContaining({ input: "summarise the news" }),
    );
  });

  test("no input step when the execution does not need one", async () => {
    payload = { schedules: [], runs: [], inputRequired: false };
    setup();
    renderModal();
    await startCreating();
    await next();
    expect(screen.queryByLabelText("Fixed input")).not.toBeInTheDocument();
    expect(screen.getByText("Before you schedule it")).toBeInTheDocument();
  });

  test("a settings step appears only while background switches are off, and they work", async () => {
    background = { launchAtLogin: false, runInBackground: true };
    payload = { schedules: [], runs: [], inputRequired: false };
    setup();
    renderModal();
    await startCreating();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    await next();

    expect(screen.getByText("Keep HiveAI running")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Open HiveAI when I log in"));
    await waitFor(() =>
      expect(mockApiClient.put).toHaveBeenCalledWith("/api/app/background", { launchAtLogin: true }),
    );
    // The step stays put after the switch flips; you leave it with Next.
    expect(screen.getByText("Keep HiveAI running")).toBeInTheDocument();
    await next();
    expect(screen.getByText("Before you schedule it")).toBeInTheDocument();
  });

  test("Back returns to the previous step and keeps what was entered", async () => {
    payload = { schedules: [], runs: [], inputRequired: true };
    setup();
    renderModal();
    await startCreating();
    await next();
    await userEvent.type(screen.getByLabelText("Fixed input"), "keep me");
    await click("Back");
    expect(screen.getByText("When should it run?")).toBeInTheDocument();
    await next();
    expect(screen.getByLabelText("Fixed input")).toHaveValue("keep me");
  });

  test("Cancel on the first step goes back to the list without saving", async () => {
    const created = vi.fn();
    payload = { schedules: [], runs: [], inputRequired: false };
    setup([{ method: "post", match: "/api/schedules/executions/1", handler: created }]);
    renderModal();
    await startCreating();
    await click("Cancel");
    expect(await screen.findByText("No schedules yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add schedule/i })).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  test("every 5 minutes is one pick away and saves as a cron schedule", async () => {
    const created = vi.fn(() => ok(schedule));
    payload = { schedules: [], runs: [], inputRequired: false };
    setup([{ method: "post", match: "/api/schedules/executions/1", handler: created }]);
    renderModal();
    await startCreating();
    await userEvent.selectOptions(screen.getByLabelText("Frequency"), "minutes");
    expect(screen.getByLabelText("Interval")).toHaveValue("5");
    expect(await screen.findByText("Every 5 minutes", {}, SLOW)).toBeInTheDocument();
    await next();
    await click("Accept and schedule");
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/schedules/executions/1",
      expect.objectContaining({ frequency: "cron", cron: "*/5 * * * *" }),
    );
  });

  test("a custom cron is explained in words, and the backend's complaint blocks Next", async () => {
    payload = { schedules: [], runs: [], inputRequired: false };
    let reply: () => unknown = () => ok({ nextRuns: [Date.now() + 60000] });
    setup([{ method: "post", match: "/api/schedules/preview", handler: () => reply() }]);
    renderModal();
    await startCreating();
    await userEvent.selectOptions(screen.getByLabelText("Frequency"), "custom");

    const field = screen.getByLabelText("Cron expression");
    await userEvent.clear(field);
    await userEvent.type(field, "0 9 * * 1-5");
    expect(await screen.findByText(/Monday through Friday/, {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText(/Next:/, {}, SLOW)).toBeInTheDocument();
    // The step tells the wizard about problems one render later, so wait for it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(), SLOW);

    reply = () => {
      throw Object.assign(new Error("x"), {
        response: { data: { errors: ["Minute must be between 0 and 59."] } },
      });
    };
    await userEvent.clear(field);
    await userEvent.type(field, "99 9 * * *");
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("Minute must be between 0 and 59.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeDisabled(), SLOW);
  });

  test("weekly needs at least one day", async () => {
    payload = { schedules: [], runs: [], inputRequired: false };
    setup();
    renderModal();
    await startCreating();
    await userEvent.selectOptions(screen.getByLabelText("Frequency"), "weekly");
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      await userEvent.click(screen.getByRole("button", { name: day }));
    }
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("editing is one short step: no settings and no warning again", async () => {
    const patched = vi.fn(() => ok(schedule));
    setup([{ method: "patch", match: "/api/schedules/5", handler: patched }]);
    renderModal();
    await userEvent.click(await screen.findByLabelText("Edit schedule"));

    expect(screen.queryByText(/Step 1 of/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Time")).toHaveValue("10:00");
    const time = screen.getByLabelText("Time");
    await userEvent.clear(time);
    await userEvent.type(time, "11:30");
    await click("Save");

    await waitFor(() => expect(patched).toHaveBeenCalled());
    expect(mockApiClient.patch).toHaveBeenCalledWith(
      "/api/schedules/5",
      expect.objectContaining({ frequency: "daily", timeOfDay: "11:30" }),
    );
  });

  test("editing a 10-minute schedule reopens as 'every 10 minutes', not raw cron", async () => {
    payload = {
      schedules: [{ ...schedule, frequency: "cron", cron: "*/10 * * * *" }],
      runs: [],
      inputRequired: false,
    };
    setup();
    renderModal();
    await userEvent.click(await screen.findByLabelText("Edit schedule"));
    expect(screen.getByLabelText("Frequency")).toHaveValue("minutes");
    expect(screen.getByLabelText("Interval")).toHaveValue("10");
  });
});

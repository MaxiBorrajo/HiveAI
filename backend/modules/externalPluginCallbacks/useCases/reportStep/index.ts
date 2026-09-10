import { reportPluginStepForCall } from "../../../../core/microkernel/step-capture.ts";

export async function handleExternalPluginReportStep(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.json();
  const { callId, label } = body;

  if (typeof label !== "string") {
    return Response.json(
      { error: "'label' is required and must be a string." },
      { status: 400, headers },
    );
  }

  if (typeof callId !== "string") {
    // No callId means the external plugin ran outside of any tracked
    // Executor invocation (e.g. a manual test hit against the subprocess) —
    // silently accept it rather than erroring, since there's nowhere
    // meaningful for the step to go.
    return Response.json({ ok: true, recorded: false }, { headers });
  }

  // AsyncLocalStorage doesn't survive this HTTP hop from the subprocess (an
  // inbound request is a fresh async context, unrelated to whichever
  // captureSteps() call is waiting on the outbound fetch that triggered it —
  // verified this doesn't propagate). callId is the explicit correlation
  // that stands in for it; see step-capture.ts for the full picture.
  const recorded = reportPluginStepForCall(callId, label);
  return Response.json({ ok: true, recorded }, { headers });
}

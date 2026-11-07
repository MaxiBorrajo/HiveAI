# LLM evals

The evals measure how well a model does HiveAI's real work: picking the right
plugin, extracting parameters, generating and executing flows, and writing
text where there's no single right answer. Code lives in
`backend/tests/llm-eval/`; commands run from `backend/`.

## Suites and metrics

| Suite | Metrics (categories) it produces | Graded by |
|---|---|---|
| `routing` | `routing`, `abstention`, `param-extraction`, `multi-turn` | exact match (expected tool / params) |
| `generation` | `generation` (code / flow generation) | exact checks on the generated graph |
| `execution` | `execution` (tool calling inside a flow) | exact checks on the final state |
| `summarization` | `summarization` | an LLM judge |

## Running evals

```bash
deno task eval -- --executor=qwen3:8b                         # every suite that needs no judge
deno task eval -- --executor=qwen3:8b --judge=lfm2.5          # every suite, judged ones included
deno task eval -- --suite=summarization --executor=anthropic:claude-haiku-4-5 --judge=qwen3:8b
deno task eval -- --executor=qwen3:8b --config rag=on --config token-opt=off   # label the run's setup
```

- A model is `provider:model` for cloud (`anthropic:…`, `google:…`) and the
  bare Ollama tag for local ones. Cloud keys come from `ANTHROPIC_API_KEY` /
  `GOOGLE_API_KEY`, or name another env var with `--executor-key` / `--judge-key`.
- Each run is written to `tests/llm-eval/results/<run-id>.jsonl`, one line per
  case.
- `--config key=value` (repeatable) records how the run was set up. The
  comparison shows these labels as what sets the runs apart.

## The judge

Suites without a single exact answer are graded by a **judge model**.

- Each case declares a **rubric**, a **reference answer**, or both, plus a
  `rubricVersion` you bump whenever either changes (`judgedCases.ts`).
- The judge returns a **score from 0 to 100 and a one-line justification**. A
  case **passes at 70 or more** (`PASS_SCORE_THRESHOLD` in `judge.ts`).
  Pass/fail always comes from the score, never from the judge's own opinion.
- The judge must be **chosen explicitly and be a different model** than the
  one being evaluated. Without `--judge`, judged suites are skipped (or fail
  if they were asked for by name). `--allow-self-judge` exists only for
  smoke tests.
- Each case records the judge, the rubric version, the score and the
  justification. The judge's tokens and cost are kept **apart** from the
  evaluated model's.
- If the judge fails or answers in an invalid format, the case is marked
  **unjudged**. It doesn't stop the run and counts as neither pass nor fail
  in any average.

## Case-set version

Each suite's case set has a version: a short hash of its case definitions
(`casesVersion.ts`). It changes on its own whenever a case is added, removed
or edited, so nobody has to remember to bump it. Runs and profiles record it,
and results from different case sets are flagged as **not comparable**.

## Cost

Cost is computed from token counts with the list prices in `pricing.ts`
(USD per million tokens, matched by model-name prefix). Local models cost 0.
**Check those prices against each provider's pricing page** and add any model
you evaluate that isn't listed. A model with no price shows its cost as
"unknown" instead of guessing.

## Export and compare

```bash
deno task eval:export -- results/<run>.jsonl --format=md      # json | md | html
deno task eval:compare -- results/a.jsonl results/b.jsonl [more.jsonl] --format=html
```

- **Export**: a summary (cases, passed, unjudged, average judge score,
  tokens, cost, time, model, judge, rubric, configuration), a per-category
  table and every case with its score and the judge's justification.
  Unjudged cases are listed apart.
- **Compare** (2 or more runs): what differs between the runs (model, judge,
  configuration); pass rate, judge score, tokens, cost and time per category,
  each with its change against the first run; which cases improved or
  worsened; and every case side by side. In HTML, open a case to read the
  judge's justification. It warns when the runs used different judges or
  rubric versions, and marks a category **not comparable** when its case set
  differs.

## Model profiles

A profile records what a model is good and bad at, metric by metric, so it
doesn't have to be re-tested every time.

- **From the app**: Models → a local model's *Details* (or *Eval profile* on a
  cloud model) → **Evaluate**. Choose the categories, a judge if a judged one
  is selected, see the estimated cost, and start. Progress is shown live and
  the run can be cancelled.
- **From the CLI**:
  `deno task eval:profile -- --executor=<model> [--judge=<model>] [--categories=routing,summarization] [--confirm] [--estimate]`

Each metric stores its value, level, date, case-set version, judge, rubric
version, model build (the Ollama digest), tokens, cost and time, plus the run
it came from. Re-running keeps the full history, and the app shows the latest
result and its evolution.

**Levels** (`LEVEL_THRESHOLDS` in `profile.ts`). The value is the pass rate
for exact-match metrics, or the average judge score ÷ 100 for judged ones.

| Level | Value |
|---|---|
| Very good | 90% or more |
| Good | 70% – 89% |
| Fair | 50% – 69% |
| Poor | below 50% |

- **Unjudged** cases don't count toward the value, and the profile shows how
  many there were.
- **Low confidence**: a metric graded on fewer than 5 cases
  (`LOW_CONFIDENCE_MIN_CASES`).
- **Out of date**: the case set or the model build changed since the result
  was recorded. The evolution also notes when the judge changed between runs.
- **Cloud models**: before running, the estimated cost is shown and has to be
  accepted (`--confirm` on the CLI). The estimate uses the model's own past
  token use, or typical figures when it has none.
- **Cancel or failure**: each suite's metrics are saved as soon as that suite
  finishes. Cancelling or failing keeps the suites already done, and the
  suite in progress leaves its previous results untouched. Profiles are
  written atomically, so an interrupted write never corrupts one.
- **Export**: from the app (Markdown, HTML or JSON, saved to Downloads), the
  profile together with the full results of the runs behind it.

Profiles and the runs made from the app live in `~/.hiveai/evals/`
(`profiles/` and `results/`), shared by the app and the CLI.
`HIVEAI_EVAL_DIR` overrides the location; the tests use it to work in a temp
folder.

In the app, an evaluation runs in a **separate process** (`main.ts
eval-profile …`), because evals reconfigure the plugin microkernel and open
their own database. That process uses the app's saved API keys.

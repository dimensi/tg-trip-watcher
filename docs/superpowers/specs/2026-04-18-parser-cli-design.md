# Parser debug CLI — design spec

## Goal

Provide a **command-line entrypoint** to run the same tour parsing pipeline as production (`regex` → optional `LLM` merge) **without starting the Telegram bot or watcher**, feeding **one post** at a time and printing a **structured trace** so the operator can see whether regex alone sufficed and what the LLM contributed.

## Non-goals

- Batch processing of directories or multiple files (out of scope; may be added later).
- Changing filter logic (`tourFilters`) or notification behavior.
- A separate HTTP server or UI.

## Parser API: `parseTourWithTrace`

Add **`parseTourWithTrace`** (exact name may be adjusted during implementation) in the parser module alongside `parseTour`.

**Behavior** must match **`parseTour`** today:

1. `regexResult = regexParseTour(text)`.
2. If `hasRequiredTourFields(regexResult) || hasUsableTourFields(regexResult)`:
   - `result = { ...regexResult, confidence: 0.85 }`.
   - `route = "regex"`.
   - Do **not** call the LLM.
   - `llm` is omitted from the trace.
3. Else:
   - `llmResult = await llmParser(text)` (default `llmParseTour`).
   - `result` = same merged object as in `parseTour` (field-wise merge and `confidence: Math.max(llmResult.confidence, 0.7)`).
   - `route = "llm-merge"`.
   - Include **`llm: llmResult`** in the trace (raw LLM output before merge semantics are applied for display).

**`parseTour`** should remain the public surface for the app: either implemented by delegating to `parseTourWithTrace` and returning only `result`, or sharing a single internal helper so logic cannot diverge.

**Return type (conceptual):**

```ts
{
  route: 'regex' | 'llm-merge';
  regex: /* same shape as regexParseTour output */;
  llm?: ParsedTour; // only when route === 'llm-merge'
  result: ParsedTour;
}
```

## CLI

**Invocation**

- **Script:** exposed via `package.json` (e.g. `npm run parse-post` or `npm run parser:debug` — final name in implementation).
- **Input text:**
  - If **one non-option argument** is present: treat it as the full post (single-line or use shell quoting for newlines).
  - If **no text argument**: read **stdin** to EOF (supports pipes and pasted multiline input).
- **Options:**
  - `--config <path>`: optional path to JSON config file. If omitted, use the same default as the app (`data/config.json` via existing `initJsonConfig` behavior).

**Environment**

- Same as running the worker for LLM: **`.env`** loaded when present; **`OPENROUTER_API_KEY`** required when the pipeline reaches the LLM.
- **`initJsonConfig()`** before parsing so OpenRouter model/timeouts match `data/config.json` (or `--config`).

**No Telegram:** do not import or start bot/watcher code paths.

**Output**

- **stdout:** single JSON document, pretty-printed by default (2-space indent), with keys:
  - `route`, `regex`, `llm` (if any), `result` — as above.
- **stderr:** human-readable errors (missing input, missing API key when LLM needed, network/API failures).

**Exit codes**

- `0` — success, JSON printed.
- `1` — usage error (no input, bad flags).
- `2` — runtime error (config, missing env for LLM, LLM/parse failure).

(Exact mapping can be adjusted if the project already standardizes exit codes; document any change in the implementation plan.)

## Testing

- **Unit tests** for `parseTourWithTrace` with a **mock `llmParser`** (no network): cover both `regex` and `llm-merge` routes and assert merge equality with current `parseTour` behavior.
- **No requirement** to run live OpenRouter calls in default `npm test`; optional manual or env-gated live check remains possible.

## Files (indicative)

- `src/parser/index.ts` — add `parseTourWithTrace`, keep `parseTour` DRY.
- New small module e.g. `src/cli/parsePost.ts` (or `src/parser/cli.ts`) — argv/stdin, env, print JSON.
- `package.json` — add script entry.

## Open decisions left to implementation plan

- Exact npm script name and binary-style alias if any.
- Whether to use a minimal argv parser or manual `process.argv` (keep dependencies at zero unless already present).

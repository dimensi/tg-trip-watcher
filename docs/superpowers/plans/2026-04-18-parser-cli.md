# Parser debug CLI implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `parseTourWithTrace`, decouple `llmParser` from the heavy `env` barrel so parser tooling works without Telegram secrets, and ship a `parse-post` CLI that prints JSON trace per `docs/superpowers/specs/2026-04-18-parser-cli-design.md`.

**Architecture:** Implement trace + merge in `src/parser/index.ts` with `parseTour` delegating to the same logic. Refactor `llmParser` to import `getJsonConfig` only from `jsonConfig.ts` and lazily build the OpenAI client using `process.env.OPENROUTER_API_KEY` so importing the parser does not execute `env.ts` (Telegram/BOT requirements). CLI entry `src/cli/parsePost.ts` calls `dotenv.config()`, sets `CONFIG_PATH` from `--config` before any `jsonConfig` import, then dynamic-imports config + parser, reads stdin or one arg, prints pretty JSON, uses exit codes 0/1/2.

**Tech stack:** Node 20+, TypeScript (CommonJS), `tsx` for dev CLI, `node:test` / `assert` for tests, existing `dotenv`, `openai`, `zod` (jsonConfig).

---

## File map

| File | Action |
|------|--------|
| `src/parser/llmParser.ts` | Modify: drop barrel `../config` import; lazy OpenAI client; `getJsonConfig` from `../config/jsonConfig` |
| `src/parser/index.ts` | Modify: add `ParseTourTrace`, `parseTourWithTrace`, refactor `parseTour` to use it |
| `src/parser/parseTourWithTrace.test.ts` | Create: unit tests with mock LLM |
| `src/cli/parsePost.ts` | Create: argv, stdin, dynamic imports, JSON stdout |
| `package.json` | Modify: add `"parse-post": "tsx src/cli/parsePost.ts"` |
| `README.md` | Modify: short section for `npm run parse-post` (optional one paragraph) |

---

### Task 1: Decouple `llmParser` from `config` barrel

**Files:**
- Modify: `src/parser/llmParser.ts`

**Why:** `import { … } from '../config'` loads `env.ts`, which `required()`s `TELEGRAM_*` and `BOT_TOKEN`. Parser CLI and tests that only need OpenRouter must not load that module.

- [ ] **Step 1: Replace imports and lazy client**

Replace the top of `llmParser.ts` so it:
- Imports `getJsonConfig` only from `'../config/jsonConfig'` (not `'../config'`).
- Removes `envConfig` usage entirely.
- Uses a lazy helper to construct `OpenAI` once:

```ts
import OpenAI from 'openai';
import pino from 'pino';
import { getJsonConfig } from '../config/jsonConfig';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'llm-parser' });

let client: OpenAI | null = null;

const getOpenRouterClient = (): OpenAI => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY');
  }
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });
  }
  return client;
};
```

In `llmParseTour`, replace `client.chat.completions.create` with `getOpenRouterClient().chat.completions.create(...)`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`  
Expected: exit 0.

- [ ] **Step 3: Run existing parser tests**

Run: `npx tsx --test src/parser/index.test.ts`  
Expected: all tests pass (same behavior; mock LLM still used).

- [ ] **Step 4: Commit**

```bash
git add src/parser/llmParser.ts
git commit -m "refactor: load OpenRouter key without importing full env barrel"
```

---

### Task 2: `parseTourWithTrace` + delegate `parseTour`

**Files:**
- Modify: `src/parser/index.ts`

- [ ] **Step 1: Add type and implementation**

Replace the existing `parseTour` implementation with the following (single `ParsedTour` import; `Partial<ParsedTour>` is TypeScript’s built-in `Partial<>`):

```ts
import { ParsedTour } from '../types/tour';
import { hasRequiredTourFields, hasUsableTourFields, regexParseTour } from './regexParser';
import { llmParseTour } from './llmParser';

export type ParseTourRoute = 'regex' | 'llm-merge';

export type ParseTourTrace = {
  route: ParseTourRoute;
  regex: Partial<ParsedTour>;
  llm?: ParsedTour;
  result: ParsedTour;
};

export const parseTourWithTrace = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParseTourTrace> => {
  const regexResult = regexParseTour(text);

  if (hasRequiredTourFields(regexResult) || hasUsableTourFields(regexResult)) {
    const result: ParsedTour = {
      ...regexResult,
      confidence: 0.85,
    };
    return { route: 'regex', regex: regexResult, result };
  }

  const llmResult = await llmParser(text);
  const result: ParsedTour = {
    destination: regexResult.destination ?? llmResult.destination,
    nights: regexResult.nights ?? llmResult.nights,
    departureCities: regexResult.departureCities?.length
      ? regexResult.departureCities
      : llmResult.departureCities,
    dateStart: regexResult.dateStart ?? llmResult.dateStart,
    dateEnd: regexResult.dateEnd ?? llmResult.dateEnd,
    price: regexResult.price ?? llmResult.price,
    bookingUrl: regexResult.bookingUrl ?? llmResult.bookingUrl,
    confidence: Math.max(llmResult.confidence, 0.7),
  };
  return { route: 'llm-merge', regex: regexResult, llm: llmResult, result };
};

export const parseTour = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParsedTour> => {
  const trace = await parseTourWithTrace(text, llmParser);
  return trace.result;
};
```

Remove the old `parseTour` body (replaced by delegation).

Note: `hasRequiredTourFields` narrows `regexResult` in one branch — keep the same control flow as before.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`  
Expected: exit 0.

- [ ] **Step 3: Run parser tests**

Run: `npx tsx --test src/parser/index.test.ts`  
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/parser/index.ts
git commit -m "feat(parser): add parseTourWithTrace and delegate parseTour"
```

---

### Task 3: Unit tests for `parseTourWithTrace`

**Files:**
- Create: `src/parser/parseTourWithTrace.test.ts`

- [ ] **Step 1: Add failing tests first**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTourWithTrace } from './index';
import { ParsedTour } from '../types/tour';

const fullRegexPost = `Паттайя, 8 ночей
Вылет из: #Владивосток #Дальний_Восток
Даты: 15.03.26 - 23.03.26
Цена: 65700P
Бронировать: https://пртс.рф/c0g6`;

test('parseTourWithTrace: regex route without LLM', async () => {
  const mockLlm = async (): Promise<ParsedTour> => {
    throw new Error('LLM must not be called');
  };
  const trace = await parseTourWithTrace(fullRegexPost, mockLlm);
  assert.equal(trace.route, 'regex');
  assert.equal(trace.result.confidence, 0.85);
  assert.equal(trace.llm, undefined);
});

test('parseTourWithTrace: llm-merge route returns llm snapshot', async () => {
  const mockLlm = async (): Promise<ParsedTour> => ({
    destination: 'X',
    nights: 3,
    departureCities: ['Москва'],
    dateStart: '2026-01-01',
    dateEnd: '2026-01-04',
    price: 100,
    bookingUrl: 'https://example.com',
    confidence: 0.8,
  });
  const text = 'произвольный текст без структуры чтобы regex не был usable';
  const trace = await parseTourWithTrace(text, mockLlm);
  assert.equal(trace.route, 'llm-merge');
  assert.ok(trace.llm);
  assert.equal(trace.llm.destination, 'X');
  assert.equal(trace.result.destination, 'X');
});
```

- [ ] **Step 2: Run tests (expect PASS after Task 2)**

Run: `npx tsx --test src/parser/parseTourWithTrace.test.ts`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/parser/parseTourWithTrace.test.ts
git commit -m "test(parser): cover parseTourWithTrace routes"
```

---

### Task 4: CLI `parsePost.ts`

**Files:**
- Create: `src/cli/parsePost.ts`
- Modify: `package.json`

**Argv rules:** support `--config <path>` anywhere among args; exactly one positional text argument optional. If no positional, read stdin to UTF-8 string. If both missing → exit 1.

- [ ] **Step 1: Implement CLI**

```ts
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { stdin } from 'node:process';

dotenv.config();

type ParsedCli = { configPath?: string; textArg?: string };

const parseArgv = (argv: string[]): ParsedCli => {
  const rest: string[] = [];
  let configPath: string | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--config') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --config');
      }
      configPath = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      throw new Error(`Unknown option: ${a}`);
    }
    rest.push(a);
  }
  if (rest.length > 1) {
    throw new Error('Expected at most one text argument');
  }
  return { configPath, textArg: rest[0] };
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

async function main(): Promise<void> {
  let parsed: ParsedCli;
  try {
    parsed = parseArgv(process.argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  if (parsed.configPath) {
    process.env.CONFIG_PATH = path.resolve(parsed.configPath);
  }

  const { initJsonConfig } = await import('../config/jsonConfig');
  initJsonConfig();

  let text: string;
  if (parsed.textArg !== undefined) {
    text = parsed.textArg;
  } else {
    text = await readStdin();
  }
  text = text.trim();
  if (!text) {
    process.stderr.write('No input text (provide one argument or stdin)\n');
    process.exit(1);
  }

  try {
    const { parseTourWithTrace } = await import('../parser/index');
    const trace = await parseTourWithTrace(text);
    process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(2);
  }
}

void main();
```

- [ ] **Step 2: Add npm script**

In `package.json` → `"scripts"`:

```json
"parse-post": "tsx src/cli/parsePost.ts"
```

- [ ] **Step 3: Manual smoke (optional OPENROUTER)**

With only regex-sufficient sample and no LLM path:

Run: `npm run parse-post -- "$(printf '%s' 'Паттайя, 8 ночей
Вылет из: #Владивосток
Даты: 15.03.26 - 23.03.26
Цена: 65700P
Бронировать: https://пртс.рф/c0g6')"`  
Expected: exit 0, JSON with `"route": "regex"`.

- [ ] **Step 4: Lint / typecheck**

Run: `npm run typecheck && npm run lint`  
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/cli/parsePost.ts package.json
git commit -m "feat(cli): add parse-post for parser trace debugging"
```

---

### Task 5: README one-liner

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Under Docker or a new "Parser debug" bullet, add:

```markdown
## Parser debug (no Telegram)

```bash
npm run parse-post -- "paste or short post text"
# or: printf '...' | npm run parse-post
```

Requires `OPENROUTER_API_KEY` in `.env` when the pipeline takes the LLM branch. Optional: `--config /path/to/config.json`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document parse-post CLI"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| `parseTourWithTrace` + DRY `parseTour` | Task 2 |
| `route` / `regex` / `llm` / `result` | Task 2 + Task 4 output |
| stdin or one arg, `--config` | Task 4 |
| dotenv + `initJsonConfig`, no bot | Task 4 |
| stderr + exit 1/2 | Task 4 |
| Unit tests mock LLM | Task 3 |
| OpenRouter without Telegram env for parser-only imports | Task 1 |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-parser-cli.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

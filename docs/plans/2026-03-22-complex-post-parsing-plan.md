# Complex Post Parsing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Teach the parser to extract one best usable offer from free-form travel posts so the bot stops missing relevant Istanbul/Beijing-style posts that contain natural-language dates and multiple offer fragments.

**Architecture:** Add a deterministic candidate-extraction layer ahead of the current parser, parse each candidate for destination/departure/date fields, score candidates, and return the best usable result. Keep LLM fallback as a later-stage recovery path, and relax date filtering so posts with a valid `dateStart` are still matchable when `dateEnd` must be computed or is absent.

**Tech Stack:** TypeScript, Node.js test runner, `tsx --test`, existing parser/filter modules in `src/parser` and `src/filters`

---

### Task 1: Add regression fixtures for free-form travel posts

**Files:**
- Modify: `src/parser/regexParser.test.ts`
- Test: `src/parser/regexParser.test.ts`

**Step 1: Write the failing test**

Add real-world fixtures from `@vandroukitours` that cover:

- a free-form Hainan post with `из Москвы`, `21 мая`, `12 ночей`, and several links
- a post with a main offer plus a hotel-only `5* отели` follow-up block
- a post like `Стамбул в мае` where the destination is in a title line and the departure/date appear later

Expected assertions for the new tests:

- the parser prefers the main offer block over the hotel-only follow-up
- `destination`, `departureCities`, `dateStart`, and `nights` are extracted from prose
- the selected URL comes from the chosen candidate rather than a random trailing link

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/parser/regexParser.test.ts`

Expected: FAIL because the current parser only understands the rigid structured format.

**Step 3: Write minimal implementation**

Do not fix behavior yet. Only keep the new fixtures and assertions in place as the regression target for the next tasks.

**Step 4: Run test to verify it still fails for the intended reason**

Run: `npx tsx --test src/parser/regexParser.test.ts`

Expected: FAIL with assertion mismatches around missing destination, departure city, date, or wrong URL selection.

**Step 5: Commit**

```bash
git add src/parser/regexParser.test.ts
git commit -m "test: add free-form parser fixtures"
```

### Task 2: Add date parsing and date math helpers for prose dates

**Files:**
- Create: `src/parser/dateParsing.ts`
- Create: `src/parser/dateParsing.test.ts`
- Modify: `src/parser/regexParser.ts`

**Step 1: Write the failing test**

In `src/parser/dateParsing.test.ts`, add focused tests for helpers that:

- parse `24 марта` into an ISO date using the current or next logical year
- parse `21 мая` and `12 мая`
- compute `dateEnd` from `dateStart + nights`
- handle ranges like `8-9 ночей` by using `8`

Use fixed reference-year assumptions inside the helper API so tests stay deterministic.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/parser/dateParsing.test.ts`

Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Implement helper functions such as:

- `parseProseDate(value: string, options): string | undefined`
- `extractNightCount(value: string): number | undefined`
- `computeDateEnd(dateStart: string, nights: number): string`

Keep responsibilities narrow and side-effect free so `regexParser.ts` can reuse them.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/parser/dateParsing.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/parser/dateParsing.ts src/parser/dateParsing.test.ts src/parser/regexParser.ts
git commit -m "feat: add prose date parsing helpers"
```

### Task 3: Introduce candidate segmentation for free-form posts

**Files:**
- Create: `src/parser/candidateExtractor.ts`
- Create: `src/parser/candidateExtractor.test.ts`
- Modify: `src/parser/regexParser.ts`

**Step 1: Write the failing test**

In `src/parser/candidateExtractor.test.ts`, add tests that:

- split a multi-block message into several candidate segments
- keep title lines grouped with the lines that provide departure/date details
- avoid treating each bare URL line as a fully independent candidate

Use a Hainan example with a main offer block plus a separate `5* отели` block.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/parser/candidateExtractor.test.ts`

Expected: FAIL because no candidate extractor exists.

**Step 3: Write minimal implementation**

Implement a small extractor that:

- starts from paragraph splits
- groups nearby lines around anchor terms like `из`, `вылет`, `ночей`, `рублей`, `Бронировать`, `Все варианты`
- returns candidates in source order

Keep the output simple, for example:

```ts
interface CandidateSegment {
  text: string;
  startLine: number;
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/parser/candidateExtractor.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/parser/candidateExtractor.ts src/parser/candidateExtractor.test.ts src/parser/regexParser.ts
git commit -m "feat: add free-form offer candidate extraction"
```

### Task 4: Parse individual candidates and score the best one

**Files:**
- Modify: `src/parser/regexParser.ts`
- Modify: `src/parser/regexParser.test.ts`
- Test: `src/parser/regexParser.test.ts`

**Step 1: Write the failing test**

Extend `src/parser/regexParser.test.ts` with assertions that require:

- destination extraction from title lines like `Стамбул в мае`
- departure extraction from prose like `с вылетом из Москвы 12 мая`
- candidate preference for the block that has `destination + departure + dateStart`
- penalty for hotel-only blocks that contain price but no departure/date

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/parser/regexParser.test.ts`

Expected: FAIL because the current parser only inspects the entire message once and does not score candidates.

**Step 3: Write minimal implementation**

Refactor `regexParseTour` so it:

- extracts candidates
- parses each candidate for fields
- computes `dateEnd` when `dateStart` and `nights` are present
- assigns a completeness score with highest weight on `destination`, `departureCities`, and `dateStart`
- chooses the best candidate, using text order as the tie-breaker

Keep helper functions local unless they become reusable enough to move out.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/parser/regexParser.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/parser/regexParser.ts src/parser/regexParser.test.ts
git commit -m "feat: score and select best free-form offer candidate"
```

### Task 5: Relax parser completeness rules and preserve LLM fallback

**Files:**
- Modify: `src/parser/index.ts`
- Modify: `src/parser/index.test.ts`
- Modify: `src/parser/regexParser.ts`

**Step 1: Write the failing test**

In `src/parser/index.test.ts`, add tests that verify:

- `parseTour` returns a local parse without calling the LLM when the best candidate has `destination`, `departureCities`, and `dateStart`, even if price or explicit `dateEnd` is missing
- `parseTour` still falls back to the LLM when local candidate parsing cannot reach the usable threshold
- local fields override LLM values when both are present

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/parser/index.test.ts`

Expected: FAIL because `hasRequiredTourFields` still requires the old strict field set.

**Step 3: Write minimal implementation**

Replace the single strict gate with two explicit thresholds:

- `hasUsableTourFields` for local early return
- `hasRequiredTourFields` only if still needed for other internal checks

Update `parseTour` so the LLM is skipped when the local result already satisfies the user-focused minimum.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/parser/index.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/parser/index.ts src/parser/index.test.ts src/parser/regexParser.ts
git commit -m "feat: accept usable local parses before llm fallback"
```

### Task 6: Make date filters tolerant of missing or computed end dates

**Files:**
- Modify: `src/filters/tourFilters.ts`
- Modify: `src/filters/tourFilters.test.ts`

**Step 1: Write the failing test**

Add tests in `src/filters/tourFilters.test.ts` that verify:

- a tour passes date filtering when `dateStart` is in range and `dateEnd` is absent
- a computed `dateEnd` behaves the same way as an explicit one
- an out-of-range `dateStart` still rejects the tour even when `dateEnd` is absent

If `ParsedTour` currently requires `dateEnd`, use a narrowly scoped type cast in the test first, then clean that up in the next step if the domain model changes.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/filters/tourFilters.test.ts`

Expected: FAIL because `matchesFilters` currently always validates both `dateStart` and `dateEnd`.

**Step 3: Write minimal implementation**

Update `matchesFilters` so it:

- always validates `dateStart`
- validates `dateEnd` only when present

If the domain model needs it, make `dateEnd` optional in `ParsedTour` and update all affected call sites carefully.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/filters/tourFilters.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/filters/tourFilters.ts src/filters/tourFilters.test.ts src/types/tour.ts
git commit -m "feat: allow date filtering without explicit end date"
```

### Task 7: Verify end-to-end parser behavior on targeted destinations

**Files:**
- Modify: `src/parser/index.test.ts`
- Modify: `src/filters/tourFilters.test.ts`

**Step 1: Write the failing test**

Add end-to-end cases that combine parsing and filtering expectations for:

- `Стамбул` with departure from `Москва`
- `Пекин` with a prose-style post
- arrival-city partial matching on normalized destination values

The tests should confirm the bot would keep these posts instead of dropping them due to formatting differences.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/parser/index.test.ts src/filters/tourFilters.test.ts`

Expected: FAIL until the final edge cases are wired through.

**Step 3: Write minimal implementation**

Adjust any remaining normalization or tie-breaking logic needed to make the targeted scenarios pass. Avoid broad refactors that are not required by the tests.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/parser/index.test.ts src/filters/tourFilters.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/parser/index.test.ts src/filters/tourFilters.test.ts src/parser/regexParser.ts
git commit -m "test: cover targeted free-form destination matches"
```

### Task 8: Run full verification and document the behavior change

**Files:**
- Modify: `README.md`
- Test: `src/parser/regexParser.test.ts`
- Test: `src/parser/index.test.ts`
- Test: `src/filters/tourFilters.test.ts`

**Step 1: Write the failing doc/test delta**

Add a short README update describing that the parser now supports free-form posts with natural-language dates and best-candidate selection. If the README change exposes any mismatch with actual commands or behavior, fix that mismatch through the tests and implementation from earlier tasks before continuing.

**Step 2: Run verification suite**

Run:

```bash
npx tsx --test src/parser/regexParser.test.ts
npx tsx --test src/parser/index.test.ts
npx tsx --test src/filters/tourFilters.test.ts
npm run lint
npm run typecheck
```

Expected: all commands PASS.

**Step 3: Write minimal implementation**

Apply only the final README wording or cleanup needed to make the documented behavior accurate.

**Step 4: Run verification again**

Run:

```bash
npx tsx --test src/parser/regexParser.test.ts
npx tsx --test src/parser/index.test.ts
npx tsx --test src/filters/tourFilters.test.ts
npm run lint
npm run typecheck
```

Expected: all commands PASS.

**Step 5: Commit**

```bash
git add README.md src/parser src/filters src/types
git commit -m "feat: support free-form travel post parsing"
```

# Complex Post Parsing Design

**Date:** 2026-03-22

**Goal:** improve parsing of free-form travel channel posts so the bot stops missing relevant offers when the text does not follow the current rigid `destination / departure / dates / price / url` layout.

## Problem

The current regex parser expects a single structured offer per message:

- first line contains destination
- a dedicated `Вылет из` line contains departure cities
- a dedicated `Даты` line contains an explicit date range
- a dedicated `Цена` line contains price
- a single booking URL is present

This works for compact dataset-style posts but fails on channels such as `@vandroukitours`, where:

- messages are written in free-form prose
- a single message may contain several candidate offers
- useful fields are spread across multiple lines
- dates may be expressed as `с 24 марта` or `вылет 21 мая, проживание с 22 мая`
- hotel-only sub-blocks may appear next to the main flight+stay offer

The user goal is narrower than full tour normalization: do not miss relevant posts about destinations such as Istanbul or Beijing. The most important fields are:

- destination / arrival city
- departure city
- trip start date

Price, nights, booking URL, and exact date end remain useful but secondary.

## Scope

In scope:

- parse one best offer from a free-form message
- prioritize destination, departure city, and start date
- compute `dateEnd` from `dateStart + nights` when possible
- keep regex/candidate parsing as the primary path
- use LLM fallback only when the local parser cannot build a usable result

Out of scope:

- extracting every offer from one message
- perfect semantic understanding of all travel post variants
- redesigning persistence or bot commands

## Approach Options

### Option 1: Expand the current regex parser

Add more regexes directly into `regexParseTour` for alternate date, city, and price phrasings.

Pros:

- minimal structural change
- quick to implement

Cons:

- becomes brittle quickly
- hard to reason about when several offer blocks exist
- mixes extraction and offer selection into one function

### Option 2: Add a candidate extraction layer before final parsing

Split a message into candidate offer segments, parse each segment for available fields, score them, and return the best-scoring candidate.

Pros:

- fits free-form multi-block posts
- preserves deterministic and explainable local parsing
- lets the parser prefer the most complete block instead of the first price or first URL

Cons:

- more moving parts than a single regex function

### Option 3: Lean primarily on LLM parsing

Send most free-form posts to the LLM and let it infer the primary offer.

Pros:

- flexible across many text styles

Cons:

- slower and more expensive
- harder to make predictable
- unnecessary for the user goal of basic routing/filtering

## Decision

Choose Option 2.

The parser should stop treating one Telegram message as one rigid structure and instead treat it as a set of candidate offer fragments. It should return one best candidate, not all candidates. The chosen candidate should be the one with the most useful fields for filtering and triage.

## Proposed Architecture

### 1. Candidate extraction

Add a preprocessing step that turns one message into candidate offer segments.

Candidate boundaries should be based on:

- paragraph breaks
- short clusters of lines near anchor phrases such as `из`, `вылет`, `с`, `ночей`, `рублей`, `Все варианты`, `Бронировать`
- title-like lines that introduce a destination block

The goal is not perfect segmentation. The goal is to produce a small set of plausible offer candidates for scoring.

### 2. Candidate field extraction

Parse each candidate for:

- `destination`
- `departureCities`
- `dateStart`
- `nights`
- `dateEnd`
- `price`
- `bookingUrl`

Extraction rules:

- destination may come from the opening line or from phrases like `в Стамбул`, `на Хайнань`, `Таиланд`, `Пекин`
- departure city should be parsed from phrases like `из Москвы`, `из Петербурга`, `из СПб`
- `dateStart` should be parsed from phrases like `с 24 марта`, `вылет 21 мая`, `с вылетом из Москвы 12 мая`
- `nights` should support `6 ночей` and ranges like `8-9 ночей`; ranges should use the lower bound
- `dateEnd` should be computed as `dateStart + nights` when both are present
- `bookingUrl` should prefer commercial booking links inside the candidate over generic channel/share links

### 3. Candidate scoring and selection

Score each candidate by completeness, with strongest weight on:

- destination present
- at least one departure city present
- `dateStart` present

Additional score:

- `nights`
- computed or explicit `dateEnd`
- `price`
- `bookingUrl`

Negative signals:

- blocks that look like hotel-only follow-ups such as `5* отели от ...`
- blocks with price only and no departure/date context

Tie-breaker:

- prefer the earliest candidate in text order

### 4. Usable parse threshold

Introduce a more permissive threshold than the current `hasRequiredTourFields`.

A parsed result should be considered usable for downstream filtering if it has:

- `destination`
- at least one `departureCities` entry
- `dateStart`

`dateEnd` should be optional if it can be computed or if only start-date filtering is needed.

### 5. LLM fallback behavior

LLM fallback should remain in place but move later in the decision chain.

Recommended flow:

1. Run candidate extraction and scoring.
2. If the best candidate meets the usable threshold, return it immediately.
3. If the best candidate is close but incomplete, optionally merge local fields with LLM output.
4. If local parsing cannot find a usable candidate, pass the full message to the LLM fallback.

This preserves deterministic parsing for the common path and limits LLM dependency.

## Filtering Impact

Current filtering assumes both `dateStart` and `dateEnd` exist.

To support free-form posts better:

- date filtering should succeed when `dateStart` matches and `dateEnd` is missing
- computed `dateEnd` should be treated the same as explicit `dateEnd`
- arrival-city filtering should continue matching against normalized destination text

This aligns filtering with the user goal: do not miss relevant Istanbul or Beijing posts because the post omits an explicit date range.

## Error Handling

- If several URLs are present, prefer URLs from the winning candidate.
- If the winning candidate contains several URLs, prefer booking/travel domains such as `onlinetours`, `trip`, or `aviasales` over generic share links.
- If no candidate meets the usable threshold, allow LLM fallback.
- If parsing still fails, keep existing failure handling in the service layer.

## Testing Strategy

Add tests based on real-world `@vandroukitours` examples.

Required coverage:

- free-form single-offer message with prose date expression
- message containing a main offer plus hotel-only secondary block
- message containing several candidate blocks where the most complete one is not the first price mention
- `dateEnd` computation from `dateStart + nights`
- date filtering when only `dateStart` is explicitly present
- arrival and departure filtering for destinations such as Istanbul and Beijing

## Expected Outcome

After this change, the bot should keep matching relevant travel posts even when:

- the post is not formatted as a strict template
- dates are written naturally instead of as a range
- multiple links or secondary hotel blocks exist

The parser does not need to understand everything perfectly. It needs to reliably surface one useful candidate per message so the user no longer has to read channels manually just to avoid missing relevant departures.

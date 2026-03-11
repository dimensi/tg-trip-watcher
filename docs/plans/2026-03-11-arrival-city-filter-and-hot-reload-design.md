# Arrival City Filter & Hot Reload Design

## Problem

- The system filters by departure city (`departureCities`) but has no filter by arrival city.
- Users need partial matching for destination names (case-insensitive substring).
- Channel changes currently require manual process restart to take effect.
- Desired behavior is support for both bot commands and manual `data/config.json` edits.

## Scope

- Add arrival city filtering using a list (`arrivalCities`) with partial matching.
- Expose arrival-city management via bot commands.
- Keep manual JSON config edits as a supported flow.
- Remove manual restart requirement for channel changes by hot-reloading watcher subscriptions.
- Add `/reload` command as manual fallback for runtime reconfiguration.

## Non-goals

- No transliteration/synonym matching (e.g., `istanbul` != `Стамбул`).
- No database schema changes.
- No process-level self-restart from bot command.

## Architecture

### Configuration Model

Extend `filters` in JSON config schema and runtime type:

- `arrivalCities: string[]` (default `[]`)

Semantics:

- `[]` means no arrival filtering.
- Non-empty list means `tour.destination` must contain at least one configured token.

Matching rule:

- Normalize both sides with `trim().toLowerCase()`.
- Match using `destination.includes(token)`.

### Filtering Layer

`matchesFilters(tour, filters)` gains arrival-city check after existing filters:

- If `filters.arrivalCities.length === 0` -> pass.
- Else pass only when at least one token partially matches `tour.destination`.

All current filters remain unchanged (price, nights, date range, departure cities).

### Bot Commands

Add commands:

- `/addarrcity <city>`: append arrival city token (if not already present).
- `/rmarrcity <city>`: remove token (if present).
- `/reload`: trigger runtime reload of watcher subscriptions/config-dependent runtime state.

Update command metadata and text output:

- `BOT_COMMANDS`
- `/help`
- `/filters`
- `/status`

### Runtime Reload for Channel Changes

Current watcher subscribes to channels on startup only. Design introduces explicit watcher lifecycle management:

- Keep a single active watcher handler per connected client.
- On channel list change, rebind watcher subscription to new channels without process restart.
- Reuse same path for `/reload` to avoid duplicated logic.

Behavioral rules:

- If no authorized client exists, `/reload` responds with informative message and exits safely.
- If reload fails, report error and keep previous active watcher when possible.
- Changes to filters (including `arrivalCities`) are effective immediately, because `TourService` reads `getJsonConfig().filters` per message.

## Data Flow

1. User updates config via command or manual JSON edit.
2. Config is validated and stored.
3. Filter changes apply immediately during message processing.
4. Channel changes trigger watcher reload (auto via config change listener, manual via `/reload` command).
5. New messages are consumed under updated channel subscriptions.

## Error Handling

- Invalid command input returns usage examples.
- Duplicate add / missing remove operations return explicit user feedback.
- `/reload` returns success/failure with reason.
- Config parse errors keep previous in-memory config (existing behavior).
- Watcher reload errors are logged and reported to bound chat when available.

## Test Strategy

### Unit Tests

- `src/filters/tourFilters.test.ts`
  - Empty `arrivalCities` does not restrict tours.
  - Partial, case-insensitive arrival match passes.
  - No arrival token matches -> reject.

- `src/bot/commands.test.ts`
  - `/addarrcity` success/duplicate/invalid usage.
  - `/rmarrcity` success/missing/invalid usage.
  - `/reload` success and error propagation.

### Integration/Runtime Tests (Targeted)

- Verify watcher reconfiguration path is called on channel updates.
- Verify reload path does not crash when client is absent.

## Rollout Notes

- Backward-compatible: missing `arrivalCities` in existing config files resolves to default `[]`.
- Existing deployments gain hot channel updates with no manual restart.

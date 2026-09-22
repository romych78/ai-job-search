# arbeitsagentur-cli

CLI for searching jobs on the **Bundesagentur für Arbeit's Jobbörse** — Germany's
official federal employment agency job board — across any sector, including
public-sector and large-employer postings.

**Data source**: the public Jobsuche JSON API at `rest.arbeitsagentur.de/jobboerse/jobsuche-service`
(search via `/pc/v6/jobs`, detail via `/pc/v4/jobdetails/<base64(refnr)>`) — the same API
the official jobboerse.arbeitsagentur.de web/mobile app calls.
**Authentication**: none required from the user. The API needs a fixed `X-API-Key:
jobboerse-jobsuche` header, but that's a public, non-secret client ID hardcoded into
BA's own official frontend — not a personal credential — so it's a constant in the code,
not an environment variable.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** The Bundesagentur has stated (per a 2021 FragDenStaat FOI
> response) that this interface "is not designed for mass evaluation using technical
> means" and runs anti-automation protections around parts of the job-search flow.
> Keep volume low, don't use it commercially or for bulk data collection, and run it
> on your own responsibility. See `../SKILL.md` for details.

## Installation

```bash
cd .agents/skills/arbeitsagentur-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# CTO / executive roles nationwide
bun run src/cli.ts search -q "CTO" --format table

# Software developer roles in Munich, last 14 days
bun run src/cli.ts search -q "Softwareentwickler" -l "München" --jobage 14 --format table

# Full detail for one job
bun run src/cli.ts detail 12288-4929301364-S --format plain
```

See `../SKILL.md` for the full flag reference and the personal-use note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Freitext keyword search (title / skill / role). Maps to the API's `was`. |
| `--location` | `-l` | Freitext location, e.g. `"Berlin"`, `"München"`, `"Bayern"`. Maps to the API's `wo`. |
| `--jobage` | | Posted within N days, `0`-`100` (the API's documented max). Maps to `veroeffentlichtseit`. |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Cap results emitted; also sizes the API request (capped at 100). |
| `--format` | | `json` \| `table` \| `plain`. |

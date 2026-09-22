#!/usr/bin/env bun
// Self-contained CLI for searching jobs on www.stepstone.de's public search and
// detail pages. No external CLI framework, so it runs anywhere `bun` is
// available with zero install beyond the repo clone.
//
// Both `search` (page 1 of `/jobs/<slug>?q=<query>`) and `detail`
// (`/stellenangebote--...-inline.html`) are robots.txt-compliant for this CLI's
// honest, self-identifying User-Agent — see SKILL.md and url-reference.md for
// the full robots.txt analysis. Recency filtering and pagination beyond page 1
// are NOT supported: both require a second query parameter alongside `q`,
// which robots.txt disallows (`Disallow: /jobs/*?q*&*`).

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `stepstone-cli — search jobs on www.stepstone.de (Germany)

USAGE
  bun run src/cli.ts search -q "<text>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role). REQUIRED — StepStone's
                          search URL is built from the query (see NOTES).
  --jobage <days>         NOT SUPPORTED — see NOTES. Passing it exits 1.
  --page <n>              1-indexed page. Only page 1 is supported — see NOTES.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id|url>                A numeric job ID from search results (e.g. "14030156"), or a
                          full detail URL (any descriptive slug — only the trailing
                          --<id>-inline.html suffix matters).
  --format <fmt>          json (default) | plain.

EXAMPLES
  bun run src/cli.ts search -q "CTO" --format table
  bun run src/cli.ts search -q "data engineer münchen" --limit 10 --format table
  bun run src/cli.ts detail 14030156 --format plain

NOTES
  - StepStone has no separate location parameter compatible with the allowed URL
    shape — include the city in --query (e.g. -q "data engineer münchen"), the same
    workaround jobindex-search documents for Jobindex.
  - --jobage is not supported: StepStone's recency filter needs a second query
    parameter (?ag=age_1 / ?ag=age_7) alongside q, which robots.txt disallows for
    this CLI's honest User-Agent (Disallow: /jobs/*?q*&*).
  - Only page 1 (up to ~25 results) is supported, for the same robots.txt reason
    (pagination also needs a second parameter). --page 2+ exits 1 with
    PAGINATION_UNSUPPORTED rather than silently violating robots.txt.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({
          error: '--query/-q is required (e.g. -q "CTO", -q "data engineer münchen")',
          code: "NO_QUERY",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
        return null
      }
      return val
    }

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query,
      jobage,
      page,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })

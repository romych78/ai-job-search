#!/usr/bin/env bun
// Self-contained CLI for searching jobs on jobs.meinestadt.de's public search
// and detail pages. No external CLI framework, so it runs anywhere `bun` is
// available with zero install beyond the repo clone.
//
// meinestadt.de has no free-text search parameter — `search --query` resolves
// to the closest matching category in the portal's own occupation taxonomy
// (see helpers.ts). Pagination beyond page 1 and the recency filter are NOT
// supported — see SKILL.md and url-reference.md.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", l: "location" }
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

const HELP = `meinestadt-cli — search jobs on jobs.meinestadt.de (Germany)

USAGE
  bun run src/cli.ts search -q "<text>" [flags]
  bun run src/cli.ts detail <url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, role, or category). REQUIRED — resolved to
                          the closest matching category in meinestadt's own occupation
                          taxonomy (see NOTES). Categories are German; English terms like
                          "CTO" typically have no match — try "Geschäftsführer" or "Director"
                          in German instead.
  --location, -l <city>   German city (e.g. "münchen", "berlin"). Defaults to nationwide
                          ("deutschland"). Must be a city meinestadt.de recognizes — free
                          text that doesn't match a real city returns zero results.
  --jobage <days>         NOT SUPPORTED — see NOTES. Passing it exits 1.
  --page <n>              1-indexed page. Only page 1 is supported — see NOTES.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL
  <url>                   The full "url" field from a search result (e.g.
                          https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203).
                          A bare numeric ID is NOT enough — meinestadt's detail URL requires
                          the originating city. Partner "apply" redirect links (marked
                          [external] in table/plain output) cannot be fetched — see NOTES.
  --format <fmt>          json (default) | plain.

EXAMPLES
  bun run src/cli.ts search -q "Geschäftsführer" --format table
  bun run src/cli.ts search -q "Softwareentwickler" -l münchen --format table
  bun run src/cli.ts detail "https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203" --format plain

NOTES
  - meinestadt.de has no free-text search URL parameter (confirmed live: ?jobwrds=<query>
    returns the same unfiltered listing as no query at all, and robots.txt disallows that
    parameter anyway). --query is instead matched against the portal's own ~293-category
    occupation taxonomy — see SKILL.md and url-reference.md.
  - --jobage is not supported: the recency filter is an AJAX-driven page control with no
    confirmed URL parameter.
  - Only page 1 is supported: meinestadt's ?page=N pagination is disallowed site-wide by
    robots.txt (Disallow: /*?page=, Disallow: /*&page=) for this CLI's honest User-Agent.
  - Many results are partner "apply" redirect links (same-origin tracking wrapper), not
    native meinestadt listings — robots.txt disallows fetching those, so detail only works
    on native premium/standard listings (marked isExternal: false).
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
          error: '--query/-q is required (e.g. -q "Geschäftsführer", -q "Softwareentwickler")',
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
      location: typeof flags.location === "string" ? flags.location : undefined,
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
      process.stderr.write(JSON.stringify({ error: "detail requires a <url>", code: "NO_ID" }) + "\n")
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

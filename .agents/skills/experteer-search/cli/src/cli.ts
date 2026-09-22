#!/usr/bin/env bun
// Self-contained CLI for searching jobs on www.experteer.de's public search
// and detail pages (Germany's leading executive/senior-level job board). No
// external CLI framework, so it runs anywhere `bun` is available with zero
// install beyond the repo clone.
//
// Both `search` and `detail` are robots.txt-compliant for this CLI's honest,
// self-identifying User-Agent — see SKILL.md and url-reference.md.

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

const HELP = `experteer-cli — search jobs on Experteer (Germany, executive/senior-level)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role). Include a city here too —
                          Experteer has no separate location parameter (see NOTES).
  --jobage <days>         Posted within N days — a genuine server-side filter
                          (Experteer's own "since_days" parameter). Default: all.
  --page <n>              1-indexed page (25 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id|url>                A numeric job ID from search results (e.g. "59148463"), or a
                          full detail URL (any descriptive slug — only the trailing
                          numeric ID is load-bearing).
  --format <fmt>          json (default) | plain.

EXAMPLES
  bun run src/cli.ts search -q "CTO" --format table
  bun run src/cli.ts search -q "Geschäftsführer München" --jobage 30 --format table
  bun run src/cli.ts detail 59148463 --format plain

NOTES
  - Experteer has no separate location parameter — include the city in --query
    (e.g. -q "CTO Berlin"), the same workaround jobindex-search and
    stepstone-search document for their portals.
  - Company name is not shown on search-result cards (Experteer gates it behind
    a signup wall) — it IS available via \`detail\`. See SKILL.md.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
    const val = parseInt(raw as string, 10)
    if (isNaN(val)) {
      writeErrorLocal(`--${name} must be a number, got "${raw}"`, "BAD_ARG")
      return null
    }
    return val
  }

  function writeErrorLocal(error: string, code: string): void {
    process.stderr.write(JSON.stringify({ error, code }) + "\n")
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    let jobage = 9999
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
      query: typeof flags.query === "string" ? flags.query : undefined,
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
      writeErrorLocal("detail requires an <id|url>", "NO_ID")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  writeErrorLocal(`Unknown command "${cmd}"`, "BAD_CMD")
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

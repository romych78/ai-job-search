#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Michael Page Germany's public job
// board (www.michaelpage.de). No external CLI framework, so it runs
// anywhere `bun` is available with zero install beyond the repo clone.
//
// No authentication required, no personal-use restriction: robots.txt does
// not disallow the /jobs search path (with `search=`/`location=`/`page=`
// query params) or /job-detail/ pages for a generic User-Agent. See
// SKILL.md and url-reference.md for the full breakdown.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const eq = a.indexOf("=")
      if (eq !== -1) {
        const key = alias[a.slice(0, eq).replace(/^-+/, "")] ?? a.slice(0, eq).replace(/^-+/, "")
        flags[key] = a.slice(eq + 1)
        continue
      }
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

const HELP = `michaelpage-cli — search jobs on Michael Page Germany

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role).
  --location, -l <text>   Free-text place (city, region), e.g. "Berlin", "München".
  --jobage <days>         Accepted for interface compatibility but has no effect —
                          Michael Page exposes no posting-date field on search-
                          result cards (only on individual job-detail pages).
  --page <n>              1-indexed page (up to 30 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "CTO" --format table
  bun run src/cli.ts search -q "IT" -l "Berlin" --format table
  bun run src/cli.ts detail head-it-wdm-leipzig/ref/jn-082026-7077601 --format plain

No personal-use warning needed — robots.txt permits this CLI's honest,
self-identifying User-Agent on both search and detail paths. See SKILL.md.
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

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
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

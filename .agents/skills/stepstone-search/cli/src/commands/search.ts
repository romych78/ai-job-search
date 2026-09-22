import { buildSearchUrl, htmlFetch, parseSearchResults, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query: string
  /** `undefined` means the flag was not passed at all — see the JOBAGE_UNSUPPORTED check below. */
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = c.date || "—"
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(10) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(24) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  return cards
    .map(
      (c) =>
        `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  // StepStone's recency filter (`?ag=age_1` / `?ag=age_7`) and its pagination
  // parameter both require a second query parameter alongside `q`. robots.txt
  // disallows that combination for this CLI's honest User-Agent
  // (`Disallow: /jobs/*?q*&*`), and disallows a query string without `q` at all
  // (`Disallow: /jobs/*?*` with no matching `Allow`). Neither constraint is
  // worth working around, so fail fast with a clear reason instead of spending
  // a request on a URL we already know violates robots.txt. See url-reference.md.
  if (opts.jobage !== undefined) {
    writeError(
      "StepStone's recency filter (?ag=age_1 for 24h, ?ag=age_7 for 7 days) requires a " +
        "second query parameter alongside `q`, which robots.txt disallows for this CLI's " +
        "honest User-Agent (`Disallow: /jobs/*?q*&*`). --jobage is not supported — see SKILL.md.",
      "JOBAGE_UNSUPPORTED",
    )
    return 1
  }
  if (opts.page > 1) {
    writeError(
      "StepStone's pagination parameter (`page`) requires a second query parameter alongside " +
        "`q`, which robots.txt disallows for this CLI's honest User-Agent (`Disallow: /jobs/*?q*&*`); " +
        "a bare `?page=N` without `q` is disallowed too (`Disallow: /jobs/*?*`, no matching `Allow`). " +
        "Only page 1 (up to ~25 results) is supported — see SKILL.md.",
      "PAGINATION_UNSUPPORTED",
    )
    return 1
  }

  try {
    const html = await htmlFetch(buildSearchUrl(opts.query))
    const { total, results: all } = parseSearchResults(html)
    let results = all
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: results.length, page: opts.page, total }, results }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

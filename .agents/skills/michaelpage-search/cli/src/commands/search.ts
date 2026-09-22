import { SEARCH_URL, htmlFetch, parseSearchResults, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("search", opts.query)
  if (opts.location) params.set("location", opts.location)
  // Michael Page's own `page` query parameter is 0-indexed (confirmed live:
  // `page=0` is page 1, `page=1` a 404 on a 6-result set that fits on one
  // page) - this CLI's `--page` flag is 1-indexed per the repo convention,
  // so we translate here.
  const zeroIndexed = Math.max(0, opts.page - 1)
  if (zeroIndexed > 0) params.set("page", String(zeroIndexed))
  const qs = params.toString()
  return qs ? `${SEARCH_URL}?${qs}` : SEARCH_URL
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const ct = (c.employmentType || "—").slice(0, 16).padEnd(16)
    const sal = (c.salary || "—").slice(0, 20)
    return `${c.id.padEnd(50)} ${title} ${loc} ${ct} ${sal}`
  })
  const header =
    "ID (slug/ref)".padEnd(50) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "LOCATION".padEnd(20) +
    " " +
    "CONTRACT".padEnd(16) +
    " SALARY"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = parseSearchResults(html)

    // No posting-date field exists anywhere in the search-results markup
    // (see helpers.ts), so `--jobage` cannot be applied here - it is
    // accepted for interface compatibility with other portal skills but has
    // no effect. Documented in SKILL.md.
    void opts.jobage

    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.location || "—"} · ${c.employmentType || "—"} · ${c.salary || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page }, results: cards },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

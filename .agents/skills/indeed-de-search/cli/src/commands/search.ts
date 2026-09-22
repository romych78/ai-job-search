import { BASE_URL, htmlFetch, parseSearchResults, jobageToFromage, writeError, type JobCard } from "../helpers.js"

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
  if (opts.query) params.set("q", opts.query)
  params.set("l", opts.location || "Deutschland")
  const fromage = jobageToFromage(opts.jobage)
  if (fromage) params.set("fromage", fromage)
  return `${BASE_URL}/jobs?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = c.date || c.relativeDate || "—"
    return `${c.id.padEnd(16)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(16) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(24) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  return cards
    .map(
      (c) =>
        `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || c.relativeDate || "—"}\n  id: ${c.id}\n  ${c.url}`,
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  // Confirmed live: Indeed redirects anonymous requests for page 2+ to
  // secure.indeed.com/auth (sign-in required), and robots.txt separately
  // disallows the `&start=` parameter for this User-Agent bucket. Neither
  // constraint is worth working around, so fail fast with a clear reason
  // instead of spending a request on a page we already know we can't read.
  if (opts.page > 1) {
    writeError(
      "Indeed requires a signed-in session to view search results beyond page 1 for anonymous/automated " +
        "requests (unauthenticated requests with &start= redirect to secure.indeed.com/auth), and robots.txt " +
        "separately disallows `&start=` for this User-Agent bucket. Only page 1 (up to ~15 results) is supported.",
      "PAGINATION_UNSUPPORTED",
    )
    return 1
  }

  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = parseSearchResults(html).results
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(cards) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

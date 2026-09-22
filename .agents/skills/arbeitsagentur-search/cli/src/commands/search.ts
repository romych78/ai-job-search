import {
  SEARCH_PATH,
  apiGet,
  parseSearchResponse,
  clampJobage,
  writeError,
  type JobCard,
  type SearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number // days since posted, 0-100
  page: number // 1-indexed
  limit?: number
  format: "json" | "table" | "plain"
}

function buildParams(opts: SearchOpts): Record<string, string> {
  const params: Record<string, string> = {}
  if (opts.query) params.was = opts.query
  if (opts.location) params.wo = opts.location
  if (opts.jobage !== undefined) params.veroeffentlichtseit = String(clampJobage(opts.jobage))
  params.page = String(opts.page)
  // The API has no documented hard cap, but this is a government interface
  // explicitly not intended for mass automated queries (see SKILL.md) —
  // request only what's needed, capped well below any observed limit.
  const size = opts.limit !== undefined ? Math.max(1, Math.min(opts.limit, 100)) : 25
  params.size = String(size)
  return params
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const id = c.id.slice(0, 22).padEnd(22)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date || "—"
    return `${id} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(22) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const body = await apiGet<SearchResponse>(SEARCH_PATH, buildParams(opts))
    let { jobs, total } = parseSearchResponse(body)
    if (opts.limit !== undefined && opts.limit >= 0) jobs = jobs.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: jobs.length, page: opts.page, total }, results: jobs }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

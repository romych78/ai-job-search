import {
  SITEMAP_URL,
  textFetch,
  parseSitemap,
  matchesQuery,
  jobageCutoffMs,
  parseJobDetail,
  writeError,
  type JobCard,
  type SitemapEntry,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

// Safety cap on live detail-page fetches per invocation, independent of
// --limit/--page, so a broad --location filter (checked post-fetch, since
// location isn't in the sitemap) can't turn one `search` call into a crawl.
const FETCH_CAP = 30

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(48)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(48) +
    " " +
    "TITLE".padEnd(38) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(22) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const xml = await textFetch(SITEMAP_URL)
    let entries = parseSitemap(xml)

    entries = entries.filter((e) => matchesQuery(e, opts.query))

    // Sort by the sitemap's <lastmod> first, purely to fetch the
    // most-recently-touched candidates first when a query matches more than
    // FETCH_CAP postings — NOT used to filter by age (see jobageCutoffMs
    // note below: lastmod tracks incidental site-side updates, not the
    // posting date, so pre-filtering on it would silently drop genuinely
    // recent postings and keep genuinely stale ones).
    entries.sort((a, b) => {
      const ta = a.lastmod ? Date.parse(a.lastmod) : 0
      const tb = b.lastmod ? Date.parse(b.lastmod) : 0
      return tb - ta
    })

    const pageSize = opts.limit && opts.limit > 0 ? opts.limit : 10
    const skip = (opts.page - 1) * pageSize
    const wantLocation = opts.location?.trim().toLowerCase()
    const cutoff = jobageCutoffMs(opts.jobage)

    const results: JobCard[] = []
    let fetched = 0
    let idx = 0
    while (idx < entries.length && results.length < skip + pageSize && fetched < FETCH_CAP) {
      const entry: SitemapEntry = entries[idx]
      idx++
      const html = await textFetch(`https://landing.jobs/at/${entry.companySlug}/${entry.jobSlug}`)
      fetched++
      if (!html) continue
      const detail = parseJobDetail(html, entry.companySlug, entry.jobSlug)
      if (!detail) continue
      // --jobage is checked here against the detail page's real `created_at`
      // (returned as `date`), not the sitemap's <lastmod> — see note above.
      if (cutoff !== null && detail.date !== null && Date.parse(detail.date) < cutoff) continue
      if (wantLocation && !(detail.location || "").toLowerCase().includes(wantLocation)) continue
      results.push(detail)
    }

    const page = results.slice(skip, skip + pageSize)

    if (opts.format === "table") {
      process.stdout.write(renderTable(page) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        page
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: page.length, page: opts.page }, results: page },
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

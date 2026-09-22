import {
  buildListingUrl,
  htmlFetch,
  parseSearchResults,
  resolveCategory,
  resolveCategoryCode,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  /** `undefined` means the flag was not passed at all — see the JOBAGE_UNSUPPORTED check below. */
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const date = c.date || "—"
    const ext = c.isExternal ? " [external]" : ""
    return `${(c.id ?? "—").padEnd(12)} ${title} ${company} ${loc} ${date}${ext}`
  })
  const header =
    "ID".padEnd(12) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  return cards
    .map(
      (c) =>
        `${c.title}${c.isExternal ? " (external listing)" : ""}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id ?? "—"}\n  ${c.url}`,
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  // meinestadt.de's `?page=` pagination is disallowed site-wide by robots.txt
  // for this CLI's honest User-Agent (`Disallow: /*?page=`, `Disallow: /*&page=`).
  // Only page 1 is reachable without violating it. See url-reference.md.
  if (opts.page > 1) {
    writeError(
      "meinestadt.de's pagination parameter (?page=N) is disallowed site-wide by robots.txt " +
        "for this CLI's honest User-Agent (`Disallow: /*?page=`, `Disallow: /*&page=`). " +
        "Only page 1 is supported — see SKILL.md.",
      "PAGINATION_UNSUPPORTED",
    )
    return 1
  }
  // The recency/actuality filter is an AJAX-driven checkbox in the page's own
  // UI (`filter-actuality`), not a confirmed GET parameter — unlike pagination
  // and the category/city path, there's no verified robots.txt-compliant URL
  // shape for it. Rather than guess, this CLI declines it outright.
  if (opts.jobage !== undefined) {
    writeError(
      "meinestadt.de's recency filter is an AJAX-driven page control with no confirmed " +
        "URL parameter — --jobage is not supported. See SKILL.md.",
      "JOBAGE_UNSUPPORTED",
    )
    return 1
  }

  try {
    // meinestadt.de has no free-text search URL parameter (confirmed live —
    // ?jobwrds=<query> returns the same unfiltered listing as no query at
    // all). Instead, --query is resolved to the closest matching entry in the
    // portal's own occupation/category taxonomy (~293 categories) — see
    // resolveCategory() in helpers.ts and url-reference.md.
    const category = await resolveCategory(opts.query)
    if (!category) {
      if (opts.format === "table" || opts.format === "plain") {
        process.stdout.write("No results.\n")
      } else {
        process.stdout.write(
          JSON.stringify(
            {
              meta: {
                count: 0,
                page: opts.page,
                total: 0,
                note:
                  `No meinestadt.de job category matches "${opts.query}". This portal organizes jobs by a fixed ` +
                  "German occupation taxonomy, not free text — try a German job title or category name " +
                  "(e.g. \"Geschäftsführer\" instead of \"CTO\").",
              },
              results: [],
            },
            null,
            2,
          ) + "\n",
        )
      }
      return 0
    }

    const code = await resolveCategoryCode(category.sitemapUrl)
    if (!code) {
      writeError(
        `Matched category "${category.slug}" but could not extract its listing code from ${category.sitemapUrl}.`,
        "CATEGORY_CODE_NOT_FOUND",
      )
      return 1
    }

    const listingUrl = buildListingUrl(opts.location, code)
    const html = await htmlFetch(listingUrl)
    const { total, results: all } = parseSearchResults(html)
    let results = all
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: results.length, page: opts.page, total, matchedCategory: category.slug }, results },
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

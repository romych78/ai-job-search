// Data source: landing.jobs's true keyword-search endpoint (`/jobs/search` and
// `/jobs/search.json`) is Disallow'd in robots.txt for every user-agent, and its
// per-skill tag pages (`/jobs/for/<skill>`) silently fall back to an unrelated
// generic listing when the tag isn't in their fixed taxonomy — not a safe basis
// for free-text search. Instead this CLI treats `sitemap.xml` (which robots.txt
// itself points bots at via a `Sitemap:` directive) as the public job index: it
// lists every live `/at/<company-slug>/<job-slug>` posting with a `<lastmod>`,
// none of which are Disallow'd. "Search" filters that index by keyword against
// the (company-slug + job-slug) text, then fetches each matching posting's
// detail page — also not Disallow'd — for the real title/company/location/date.
// No login, no personal-use warning needed: every path this CLI touches is
// explicitly allowed by robots.txt.

export const SITEMAP_URL = "https://landing.jobs/sitemap.xml"
export const DETAIL_BASE = "https://landing.jobs/at"

const UA = "Mozilla/5.0 (compatible; landingjobs-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch text with exponential backoff on 429/5xx. Returns "" on 404 rather than throwing. */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Sitemap index
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  companySlug: string
  jobSlug: string
  url: string
  lastmod: string | null
}

/**
 * Parse sitemap.xml into job-posting candidates. Only `/at/<company>/<job>`
 * URLs (exactly two path segments after `/at/`) are postings — a single
 * segment (`/at/<company>`) is a company profile page, not a job.
 */
export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? []
  for (const block of blocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/)
    if (!locMatch) continue
    const url = locMatch[1].trim()
    const pathMatch = url.match(/^https:\/\/landing\.jobs\/at\/([^/]+)\/([^/]+)\/?$/)
    if (!pathMatch) continue
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/)
    entries.push({
      companySlug: pathMatch[1],
      jobSlug: pathMatch[2],
      url,
      lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
    })
  }
  return entries
}

/**
 * Convert a job-age in days to a millisecond cutoff (ms since epoch), or null
 * for "all". Checked against each posting's real `created_at` (only known
 * after the detail page is fetched) — the sitemap's `<lastmod>` was tried
 * first and rejected: a live check found postings with `created_at` over a
 * year old still carrying a `<lastmod>` from the last few days, so it tracks
 * incidental site updates, not the original posting date.
 */
export function jobageCutoffMs(days: number): number | null {
  if (!days || days <= 0 || days >= 9999) return null
  return Date.now() - days * 86400000
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * True if every whitespace-separated word in `query` appears as a *whole
 * word* in the candidate's de-hyphenated company+job slug (case-insensitive
 * AND match). Whole-word matching (not plain substring) matters for short
 * queries: a naive substring check for "cto" matches inside "dire-cto-r"
 * (director) — a false positive confirmed live against this portal's data.
 * Empty/undefined query matches everything.
 */
export function matchesQuery(entry: SitemapEntry, query: string | undefined): boolean {
  if (!query || !query.trim()) return true
  const haystack = `${entry.companySlug} ${entry.jobSlug}`.replace(/-/g, " ").toLowerCase()
  const words = query.toLowerCase().trim().split(/\s+/)
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(haystack))
}

// ---------------------------------------------------------------------------
// Detail-page extraction
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  category: string | null
  experienceLevel: string | null
  remoteLabel: string | null
  applyUrl: string | null
}

/**
 * Extract the React-on-Rails `jobPage/JobPage` props embedded in every
 * job-detail page as an HTML-attribute-encoded JSON blob:
 *   <div data-react-class="jobPage/JobPage" data-react-props="{...}"></div>
 * This is parsed directly instead of the visible `lj-job-summary__*` markup,
 * since the props carry structured fields (created_at, office_locations,
 * company_name) the rendered HTML doesn't expose as cleanly.
 */
export function extractJobAdAttributes(html: string): any | null {
  const marker = 'data-react-class="jobPage/JobPage" data-react-props="'
  const start = html.indexOf(marker)
  if (start === -1) return null
  const valueStart = start + marker.length
  const valueEnd = html.indexOf('"', valueStart)
  if (valueEnd === -1) return null
  const raw = html.slice(valueStart, valueEnd)
  try {
    const decoded = decodeHtmlEntities(raw)
    const data = JSON.parse(decoded)
    return data?.jobAd?.attributes ?? null
  } catch {
    return null
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

// Note: collapses horizontal whitespace (spaces/tabs) only, so any "\n"
// markers a caller inserted for paragraph breaks survive.
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim()
}

/**
 * Render the job description. `role_description` is HTML that has been
 * entity-escaped a second time inside the JSON string (e.g. literal
 * `<!--block-->` markers round-trip as `&lt;!--block--&gt;`), so entities
 * must be decoded *before* break-tags are converted to newlines and the
 * remaining tags (now-literal `<!--block-->` comments included) are
 * stripped — decoding after stripping (the order used for single-escaped
 * HTML on other portals) would leave the decoded markers behind as garbage.
 */
function renderDescription(raw: string): string {
  const decoded = decodeHtmlEntities(raw)
  const withBreaks = decoded
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return stripTags(withBreaks).replace(/\n{3,}/g, "\n\n").trim()
}

function cardFromAttributes(
  attrs: any,
  companySlug: string,
  jobSlug: string,
): JobCard {
  return {
    id: `${companySlug}/${jobSlug}`,
    title: attrs?.title ?? "(untitled)",
    company: attrs?.company_name ?? null,
    location: attrs?.location ?? null,
    date: attrs?.created_at ?? null,
    url: `${DETAIL_BASE}/${companySlug}/${jobSlug}`,
  }
}

/** Parse a job-detail page fetched from `${DETAIL_BASE}/<companySlug>/<jobSlug>`. */
export function parseJobDetail(html: string, companySlug: string, jobSlug: string): JobDetail | null {
  const attrs = extractJobAdAttributes(html)
  if (!attrs) return null
  const card = cardFromAttributes(attrs, companySlug, jobSlug)
  const descRaw: string | null = attrs.role_description ?? null
  return {
    ...card,
    description: descRaw ? renderDescription(descRaw) || null : null,
    employmentType: attrs.job_type ?? null,
    category: attrs.category ?? null,
    experienceLevel: attrs.experience_label ?? null,
    remoteLabel: attrs.remote_working_label ?? null,
    // landing.jobs handles applications on-site (no employer apply URL is
    // exposed in public job data) — the posting URL itself is the apply page.
    applyUrl: null,
  }
}

/**
 * Accept a full landing.jobs job URL, an "<company>/<job>" id (as returned by
 * `search`), or a "/at/<company>/<job>" path, and return the normalized
 * "<company>/<job>" id.
 */
export function normalizeId(input: string): string | null {
  let id = input.trim()
  const urlMatch = id.match(/landing\.jobs\/at\/([^/?#]+\/[^/?#]+)/i)
  if (urlMatch) {
    id = urlMatch[1]
  } else if (id.startsWith("/at/")) {
    id = id.slice("/at/".length)
  }
  id = id.split(/[?#]/)[0].replace(/\/+$/, "")
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(id)) return null
  return id
}

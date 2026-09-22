// Data source: www.experteer.de's public, unauthenticated job search and
// detail pages. Experteer is Germany's leading executive/senior-level job
// board. The search-results page is server-rendered by an older Rails +
// AngularJS stack (stable `job-list-item-*` CSS classes); the job-detail page
// is served from a newer Next.js stack that embeds a schema.org `JobPosting`
// block as JSON inside a `(self.__next_s=self.__next_s||[]).push([...])`
// hydration script. This CLI parses the detail page's JSON directly (more
// resilient than scraping Next.js's hashed CSS module class names, e.g.
// `styles-module-scss-module__PJGEYa__h3`) and chunks the search-results HTML
// per job card so one malformed card can't break the rest.
//
// robots.txt (checked live, https://www.experteer.de/robots.txt) carries no
// Disallow rule covering /jobs or /career/view-jobs/* for the generic
// `User-agent: *` bucket this CLI's honest UA falls into — only /export/,
// /*.pdf$, /signup_l/, /recr_account/, /wordpress/*, and /monitoring are
// disallowed, none of which this CLI touches. No personal-use warning is
// needed — see url-reference.md for the full robots.txt breakdown.

export const SEARCH_URL = "https://www.experteer.de/jobs"
export const DETAIL_BASE = "https://www.experteer.de/career/view-jobs"

const UA = "Mozilla/5.0 (compatible; experteer-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on 404 (not found / out-of-range page). */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
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
  /** Experteer's work-mode label straight from schema.org `jobLocationType`, e.g. "Hybrid", "Remote", "Onsite". */
  workMode: string | null
  salary: string | null
  deadline: string | null
  /** Always null — see Notes in SKILL.md (Experteer's "Jetzt bewerben" apply flow is an in-page action, not a resolvable link). */
  applyUrl: string | null
  industry: string | null
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points decode correctly, and
 * drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Parse the German relative-age label Experteer shows on each search card
 * ("Vor 7 Tagen veröffentlicht", "Vor 30+ Tagen veröffentlicht") into an
 * approximate ISO date. The "N+" bucket (30+ days) is open-ended — Experteer
 * doesn't expose an exact day count past that point — so it returns null
 * rather than fabricate a date, matching the repo's "null, never guessed"
 * convention. Also handles "Heute"/"Gestern" defensively even though they
 * were not observed live, since the exact-day bucket only started at 1.
 */
export function parsePublishedDate(text: string | null): string | null {
  if (!text) return null
  const t = text.trim()
  if (/^Heute/i.test(t)) return new Date().toISOString().slice(0, 10)
  if (/^Gestern/i.test(t)) return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const m = t.match(/Vor\s+(\d+)(\+?)\s*Tage?n?/i)
  if (!m) return null
  if (m[2] === "+") return null
  const days = parseInt(m[1], 10)
  if (isNaN(days)) return null
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

/** Convert a job-age in days to Experteer's `since_days` value, or null for "all" (>=9999 or unset). */
export function sinceDaysParam(days: number): number | null {
  if (!days || days <= 0 || days >= 9999) return null
  return days
}

/** Parse the total-result count from the page's `<h1 class="result-hits">` heading, e.g. "190 Jobs für 'cto'" or "65.405 Jobs". German thousands-separator dots are stripped before parsing. */
export function parseTotalCount(html: string): number | null {
  const m = html.match(/class="result-hits">\s*([\d.,]+)\s*Jobs/)
  if (!m) return null
  const num = parseInt(m[1].replace(/[.,]/g, ""), 10)
  return isNaN(num) ? null : num
}

export interface SearchPageResult {
  total: number | null
  results: JobCard[]
}

/**
 * Parse the search-results page: each job card is a `<div data-list-location=N
 * data-list-item-id='ID' class="job-list-item ...">` block. We split on that
 * marker and parse each chunk independently so one malformed card cannot
 * break the rest (same defensive pattern as `linkedin-search`'s
 * `parseJobCards`).
 *
 * Company name is deliberately NOT extracted here: Experteer hides the
 * employer name on the free/anonymous search-results list behind a
 * "sign up to see all jobs at this company" wall (confirmed live — every
 * card's `job-list-item-info` block carries only Function/Industry/Career
 * Level tags plus a `js-unlock-company-filter` upsell, never a company name).
 * `company` is always `null` in search results; it IS available on the
 * detail page (see `parseJobDetail`).
 */
export function parseSearchResults(html: string): SearchPageResult {
  const total = parseTotalCount(html)
  const results: JobCard[] = []
  const chunks = html.split(/<div data-list-location=/).slice(1)

  for (const chunk of chunks) {
    const idMatch = chunk.match(/data-list-item-id='(\d+)'/)
    if (!idMatch) continue
    const id = idMatch[1]

    const titleMatch = chunk.match(/job-list-item-title">\s*<a\s+href="([^"]+)"[^>]*?title="([^"]*)"/)
    if (!titleMatch) continue
    const relUrl = decodeHtmlEntities(titleMatch[1]).split("?")[0]
    const title = decodeHtmlEntities(titleMatch[2])
    if (!title) continue

    const locMatch = chunk.match(/City Link Interaction;\s*([^"]+)"/)
    const location = locMatch ? decodeHtmlEntities(locMatch[1]).trim() || null : null

    const dateMatch = chunk.match(/published-days-ago">\s*([^<]*?)\s*<\/div>/)
    const date = dateMatch ? parsePublishedDate(dateMatch[1]) : null

    results.push({
      id,
      title,
      company: null,
      location,
      date,
      url: relUrl.startsWith("http") ? relUrl : `https://www.experteer.de${relUrl}`,
    })
  }

  return { total, results }
}

/**
 * Extract every `(self.__next_s=self.__next_s||[]).push([...])` hydration
 * payload on the detail page. Each payload is a JSON array (`[index, {type,
 * children}, ...]`) even though it's embedded inside a JS statement, so it
 * can be parsed directly once the `.push(` wrapper and trailing `)` are
 * stripped by the regex capture group. Malformed payloads are skipped rather
 * than thrown, since a page can carry several of these blocks for unrelated
 * hydration data.
 */
function extractNextPushBlocks(html: string): any[] {
  const blocks: any[] = []
  const re = /\(self\.__next_s=self\.__next_s\|\|\[\]\)\.push\((\[[\s\S]*?\])\)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]))
    } catch {
      // Skip a block that fails to parse; other blocks are independent.
    }
  }
  return blocks
}

/** Locate the schema.org `JobPosting` ld+json block among the page's hydration payloads. */
function extractJobPosting(html: string): any | null {
  const blocks = extractNextPushBlocks(html)
  for (const block of blocks) {
    if (!Array.isArray(block) || block.length < 2) continue
    const payload = block[1]
    if (!payload || payload.type !== "application/ld+json" || typeof payload.children !== "string") continue
    try {
      const data = JSON.parse(payload.children)
      if (data?.["@type"] === "JobPosting") return data
    } catch {
      // Try the next block.
    }
  }
  return null
}

function formatSalary(baseSalary: any): string | null {
  const v = baseSalary?.value
  if (!v) return null
  const cur = typeof baseSalary.currency === "string" ? baseSalary.currency : ""
  const unit = v.unitText === "YEAR" ? "/year" : v.unitText ? `/${String(v.unitText).toLowerCase()}` : ""
  if (v.minValue != null && v.maxValue != null) return `${cur} ${v.minValue}-${v.maxValue}${unit}`.trim()
  if (v.value != null) return `${cur} ${v.value}${unit}`.trim()
  return null
}

/**
 * Parse a job-detail page via its embedded schema.org `JobPosting` block
 * rather than the visible markup (which uses hashed Next.js CSS-module class
 * names that shift on every deploy, e.g. `styles-module-scss-module__PJGEYa__h3`).
 * Returns null if no `JobPosting` block is found — either the job doesn't
 * exist (`htmlFetch` already returns "" for a genuine 404) or, occasionally,
 * a fetched page variant doesn't include the hydration block (see Notes in
 * url-reference.md); callers should surface this as "not found".
 */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const job = extractJobPosting(html)
  if (!job) return null

  const address = job.jobLocation?.address
  const location = typeof address?.addressLocality === "string" ? address.addressLocality : null

  return {
    id,
    title: typeof job.title === "string" && job.title ? decodeHtmlEntities(job.title) : "(untitled)",
    company: typeof job.hiringOrganization?.name === "string" ? job.hiringOrganization.name : null,
    location,
    date: typeof job.datePosted === "string" ? job.datePosted : null,
    url: `${DETAIL_BASE}/${id}`,
    description: typeof job.description === "string" && job.description ? job.description.trim() : null,
    employmentType: typeof job.employmentType === "string" ? job.employmentType : null,
    workMode: typeof job.jobLocationType === "string" ? job.jobLocationType : null,
    salary: formatSalary(job.baseSalary),
    deadline: typeof job.validThrough === "string" ? job.validThrough : null,
    applyUrl: null,
    industry: typeof job.industry === "string" ? job.industry : null,
  }
}

/**
 * Accept a bare numeric job ID, a full/partial `experteer.de/career/view-jobs/...`
 * URL, or a descriptive slug ending in the numeric ID (exactly what `search`
 * returns as `id`/`url`). Experteer resolves the canonical job from the
 * trailing numeric ID regardless of what precedes it — confirmed live: a
 * completely wrong slug with the right trailing ID 301s to the canonical
 * slug, and the bare ID alone (`/career/view-jobs/59148463`) resolves
 * directly. A genuinely nonexistent ID returns HTTP 404.
 */
export function normalizeId(input: string): string | null {
  let s = input.trim().split(/[?#]/)[0]
  const urlMatch = s.match(/experteer\.de\/career\/view-jobs\/([^/?#]+)/i)
  if (urlMatch) s = urlMatch[1]
  const idMatch = s.match(/(\d{5,})$/)
  return idMatch ? idMatch[1] : null
}

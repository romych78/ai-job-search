// Data source: Xing renders every page (job search results AND individual job
// detail pages) with a server-populated Apollo/GraphQL cache, embedded as a
// JSON object assigned to `window.crate` inside a <script id="runtime-config">
// tag. We extract and JSON.parse that blob instead of regex-scraping the
// visible HTML: Xing's markup uses hashed styled-components class names
// (e.g. "job-teaser-list-item-styles__Company-sc-614863cf-11") that shift on
// every deploy, while the underlying GraphQL cache shape (VisibleJob,
// JobCompanyInfo, ...) is far more stable.
//
// Personal use only — see SKILL.md. Honest, self-identifying User-Agent; no
// impersonation of Xing's named AI-crawler allowlist.

export const SEARCH_URL = "https://www.xing.com/jobs/search"
export const DETAIL_BASE = "https://www.xing.com/jobs"

const UA = "Mozilla/5.0 (compatible; xing-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on 404/410 (gone). */
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
    if (response.status === 404 || response.status === 410) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Apollo cache extraction
// ---------------------------------------------------------------------------

/**
 * Extract the `window.crate = {...}` object embedded in the page's
 * <script id="runtime-config"> tag. The value is a JS object literal, not
 * strict JSON — it can contain bare `undefined` (e.g. optional cookie
 * fields), so we normalize that to `null` before parsing. Returns null if
 * the blob is missing or fails to parse (rather than throwing), so callers
 * can surface a clear "layout changed" error instead of a cryptic crash.
 */
export function extractCrate(html: string): any | null {
  const m = html.match(/id="runtime-config">window\.crate=(\{[\s\S]*?\})<\/script>/)
  if (!m) return null
  const normalized = m[1].replace(/:undefined/g, ":null")
  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function getApolloState(html: string): Record<string, any> | null {
  const crate = extractCrate(html)
  return crate?.serverData?.APOLLO_STATE ?? null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  employmentType: string | null
  salary: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
  deadline: string | null
}

/** Resolve a Company name from either an inline override or a normalized ref. */
function resolveCompanyName(job: any, apollo: Record<string, any>): string | null {
  const override = job?.companyInfo?.companyNameOverride
  if (override) return override
  const ref = job?.companyInfo?.company?.__ref
  if (ref && apollo[ref]) return apollo[ref].companyName ?? null
  return null
}

/** Resolve an EmploymentType label from either an inline value or a normalized ref. */
function resolveEmploymentType(job: any, apollo: Record<string, any>): string | null {
  const et = job?.employmentType
  if (!et) return null
  if (et.localizationValue) return et.localizationValue
  const ref = et.__ref
  if (ref && apollo[ref]) return apollo[ref].localizationValue ?? null
  return null
}

function formatSalary(job: any): string | null {
  const s = job?.salary
  if (!s) return null
  const cur = s.currency ?? ""
  if (s.minimum != null && s.maximum != null) return `${cur} ${s.minimum}-${s.maximum}`.trim()
  if (s.minimum != null) return `${cur} ${s.minimum}+`.trim()
  if (s.maximum != null) return `${cur} up to ${s.maximum}`.trim()
  return null
}

function cardFromVisibleJob(job: any, apollo: Record<string, any>): JobCard {
  return {
    id: job.slug ?? String(job.id ?? ""),
    title: job.title ?? "(untitled)",
    company: resolveCompanyName(job, apollo),
    location: job.location?.city ?? null,
    date: job.refreshedAt ?? null,
    url: job.url ?? (job.slug ? `${DETAIL_BASE}/${job.slug}` : ""),
    employmentType: resolveEmploymentType(job, apollo),
    salary: formatSalary(job),
  }
}

/**
 * Parse the search-results page: the Apollo cache holds one
 * `ROOT_QUERY.jobSearchByQuery(...)` entry (the key includes the serialized
 * query args, which vary run-to-run, so we find it by prefix) whose
 * `.collection` is a list of `{ jobDetail: { __ref: "VisibleJob:<id>" } }`
 * pointers into the flat cache.
 */
export function parseSearchResults(html: string): JobCard[] {
  const apollo = getApolloState(html)
  if (!apollo) return []
  const root = apollo["ROOT_QUERY"]
  if (!root) return []
  const key = Object.keys(root).find((k) => k.startsWith("jobSearchByQuery("))
  if (!key) return []
  const collection: any[] = root[key]?.collection ?? []

  const cards: JobCard[] = []
  for (const item of collection) {
    const ref = item?.jobDetail?.__ref
    if (!ref) continue
    const job = apollo[ref]
    if (!job) continue
    cards.push(cardFromVisibleJob(job, apollo))
  }
  return cards
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
// markers a caller inserted for paragraph breaks survive. A naive `\s+` here
// would collapse those newlines right back into spaces.
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim()
}

/** Render the rich-text job description, keeping paragraph/list breaks as newlines. */
function renderDescription(descHtml: string): string {
  const withBreaks = descHtml
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Parse a job-detail page. `slug` disambiguates the primary job from the
 * "similar jobs" sidebar, which embeds several other VisibleJob entries in
 * the same cache.
 */
export function parseJobDetail(html: string, slug: string): JobDetail | null {
  const apollo = getApolloState(html)
  if (!apollo) return null
  const key = Object.keys(apollo).find(
    (k) => k.startsWith("VisibleJob:") && apollo[k]?.slug === slug,
  )
  if (!key) return null
  const job = apollo[key]
  const card = cardFromVisibleJob(job, apollo)
  const descHtml: string | null = job.description?.content ?? null
  return {
    ...card,
    description: descHtml ? renderDescription(descHtml) || null : null,
    applyUrl: job.application?.applyUrl ?? null,
    deadline: job.activeUntil ?? null,
  }
}

/**
 * Accept a full Xing job URL, a "/jobs/<slug>" path, or a bare slug and
 * return the normalized slug. Xing's detail pages require the *exact* slug
 * (a right-shaped-but-wrong slug returns HTTP 410, not a redirect), and a
 * bare numeric ID is not a valid lookup key on this portal — it gets
 * interpreted as a search keyword instead. So we require a slug that ends
 * in the numeric job ID, which is exactly what `search` returns as `id`.
 */
export function normalizeSlug(input: string): string | null {
  let slug = input.trim()
  const urlMatch = slug.match(/xing\.com\/jobs\/([^/?#]+)/i)
  if (urlMatch) {
    slug = urlMatch[1]
  } else if (slug.startsWith("/jobs/")) {
    slug = slug.slice("/jobs/".length)
  }
  slug = slug.split(/[?#]/)[0]
  if (!/^[a-z0-9-]+-\d+$/i.test(slug)) return null
  return slug
}

/** Convert a job-age in days to a millisecond cutoff (ms since epoch), or null for "all". */
export function jobageCutoffMs(days: number): number | null {
  if (!days || days <= 0 || days >= 9999) return null
  return Date.now() - days * 86400000
}

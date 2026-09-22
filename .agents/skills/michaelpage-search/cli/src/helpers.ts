// Data source: Michael Page Germany's public Drupal-backed job board
// (www.michaelpage.de/jobs). Search results are plain server-rendered HTML —
// each real result is a `<div class="job-tile search-job-tile ...">`; a
// portal quirk (verified live) pads thin result sets with a
// "Andere Bewerber haben sich auch auf diese Jobs beworben" ("other
// applicants also applied to") recommendation block whose tiles carry the
// class `job-tile recommended-job-tile search-job-tile` (note the extra
// "recommended-job-tile" token *before* "search-job-tile") — our anchor
// regex below only matches the literal `class="job-tile search-job-tile`
// prefix, so those recommended tiles are excluded automatically.
//
// Detail pages carry a single unambiguous `job-apply-block-container` block
// for the primary job (title/location/contract-type/salary) plus a
// schema.org `application/ld+json` JobPosting block for the full
// description and posting date. Detail pages also embed a "similar jobs"
// carousel using the *same* job-tile-ish markup as search results, so detail
// parsing anchors on `job-apply-block-container` rather than reusing the
// search-tile regex, to avoid ever reading a carousel entry by mistake.
//
// No authentication required for either search or job detail. robots.txt
// does not disallow these paths for a generic User-Agent — see
// url-reference.md for the full breakdown. No personal-use warning needed.

export const SEARCH_URL = "https://www.michaelpage.de/jobs"
export const DETAIL_BASE = "https://www.michaelpage.de/job-detail"

const UA = "Mozilla/5.0 (compatible; michaelpage-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on 404. */
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
  employmentType: string | null
  remote: string | null
  salary: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
  deadline: string | null
}

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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

function fieldFrom(chunk: string, className: string, tag: "div" | "span"): string | null {
  const re = new RegExp(
    `<${tag} class="${className}">\\s*(?:<i[^>]*></i>)?\\s*([^<]*)</${tag}>`,
  )
  const m = chunk.match(re)
  if (!m) return null
  const text = clean(m[1])
  return text || null
}

/**
 * Parse the search-results page. Real result tiles are split by the exact
 * anchor `class="job-tile search-job-tile` (the "other applicants also
 * applied" recommendation padding uses `job-tile recommended-job-tile
 * search-job-tile`, which never matches this literal prefix). Each tile's
 * `about="/job-detail/<slug>/ref/<ref>"` attribute is the canonical detail
 * path and doubles as this CLI's `id` (minus the leading `/job-detail/`).
 */
export function parseSearchResults(html: string): JobCard[] {
  const tileRe = /<div about="([^"]+)" class="job-tile search-job-tile/g
  const starts: { index: number; path: string }[] = []
  let m: RegExpExecArray | null
  while ((m = tileRe.exec(html)) !== null) {
    starts.push({ index: m.index, path: m[1] })
  }

  const cards: JobCard[] = []
  for (let i = 0; i < starts.length; i++) {
    const { index, path } = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length
    const chunk = html.slice(index, end)

    const titleMatch = chunk.match(
      /<div class="job-title[^"]*"[^>]*><h3><a[^>]*>([\s\S]*?)<\/a><\/h3>/,
    )
    const title = titleMatch ? clean(titleMatch[1]) : null
    if (!title) continue

    // Left percent-encoded exactly as the portal's own markup carries it
    // (e.g. a slug with "ö" appears as "l%C3%B6sungen") so it can be reused
    // verbatim as a URL path segment without an encode/decode round trip.
    const id = path.replace(/^\/job-detail\//, "")
    cards.push({
      id,
      title,
      // Michael Page is a retained/executive-search agency: the real hiring
      // company is deliberately withheld ("unser Mandant" / "our client" in
      // the description) until later in the process. Reporting it as null
      // (rather than "Michael Page", the agency itself) avoids a downstream
      // CV/cover-letter workflow ever mistaking the agency for the employer.
      company: null,
      location: fieldFrom(chunk, "job-location", "div"),
      // No posting-date field exists anywhere on the search-results markup
      // (only job-detail pages carry one, via schema.org ld+json).
      date: null,
      url: `https://www.michaelpage.de${path}`,
      employmentType: fieldFrom(chunk, "job-contract-type", "div"),
      remote: fieldFrom(chunk, "job-nature", "div"),
      salary: fieldFrom(chunk, "job-salary", "div"),
    })
  }
  return cards
}

/** Render the rich-text job description, keeping paragraph/list breaks as newlines. */
function renderDescription(descHtml: string): string {
  const withBreaks = descHtml
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Extract the schema.org JobPosting block embedded on every detail page as
 * `<script type="application/ld+json">`. The blob is otherwise well-formed
 * JSON except for one quirk: the `description` value contains raw, literal
 * newline characters (invalid inside a JSON string), which makes
 * `JSON.parse` throw "Invalid control character" as-is. We normalize by
 * trimming the trailing newline the portal appends after the closing `}`
 * (which would otherwise become trailing garbage after the newline
 * substitution) and then escaping any remaining literal newlines to `\n`
 * sequences — mirroring the `:undefined` -> `:null` normalization
 * `xing-search` uses for a similarly "almost JSON" blob.
 */
function extractJobPosting(html: string): any | null {
  const m = html.match(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
  )
  if (!m) return null
  const raw = m[1].trim()
  const normalized = raw.replace(/\r\n/g, "\\n").replace(/\n/g, "\\n").replace(/\r/g, "\\n")
  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function formatSalaryFromLdJson(posting: any): string | null {
  const s = posting?.baseSalary?.value
  if (!s) return null
  const cur = posting.baseSalary.currency ?? ""
  if (s.minValue != null && s.maxValue != null) {
    return `${cur} ${s.minValue}-${s.maxValue}`.trim()
  }
  return null
}

/**
 * Parse a job-detail page. The primary job's own fields live in the unique
 * `job-apply-block-container` block (title/location/contract-type/salary) -
 * detail pages also embed a "similar jobs" carousel that reuses job-tile-ish
 * markup, so we deliberately do NOT reuse the search-tile parser here, to
 * avoid ever reading a carousel entry instead of the real job.
 */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const blockMatch = html.match(
    /<div class="job-apply-block-container" about="([^"]+)">([\s\S]*?)<span class="jaj-info-wrapper"/,
  )
  if (!blockMatch) return null
  const block = blockMatch[2]

  const titleMatch = block.match(/<h1 class="job-apply-job-title"><span>([\s\S]*?)<\/span><\/h1>/)
  const title = titleMatch ? clean(titleMatch[1]) : null
  if (!title) return null

  const posting = extractJobPosting(html)
  const description = posting?.description ? renderDescription(posting.description) || null : null

  const path = blockMatch[1]
  return {
    id,
    title,
    // See the note in parseSearchResults: the real employer is intentionally
    // anonymized by this recruiter, so we never report "Michael Page" (the
    // agency's own name from ld+json's hiringOrganization) as the company.
    company: null,
    location: fieldFrom(block, "job-location", "span"),
    date: posting?.datePosted ?? null,
    url: `https://www.michaelpage.de${path}`,
    employmentType: fieldFrom(block, "job-contract-type", "span") ?? posting?.employmentType ?? null,
    remote: fieldFrom(block, "job-nature", "span"),
    salary: fieldFrom(block, "job-salary", "span") ?? formatSalaryFromLdJson(posting),
    description,
    // Constructed, not fetched: robots.txt disallows /job-apply/ paths for
    // this CLI's honest User-Agent, so the apply URL is reported for the
    // user to open in a browser, never requested by this tool.
    applyUrl: `https://www.michaelpage.de/job-apply${path.replace(/^\/job-detail/, "")}`,
    // No validThrough / application-deadline field exists in Michael Page's
    // ld+json JobPosting data (confirmed live).
    deadline: null,
  }
}

/**
 * Accept a full michaelpage.de job URL, a "/job-detail/<slug>/ref/<ref>"
 * path, or the bare "<slug>/ref/<ref>" id `search` returns, and return the
 * normalized "<slug>/ref/<ref>" id. Michael Page's detail pages are a Drupal
 * URL alias requiring the *exact* slug+ref pair — a bare ref, a bare slug,
 * or a mismatched slug/ref combination all 404 (confirmed live; no fuzzy
 * redirect to the canonical URL).
 */
export function normalizeId(input: string): string | null {
  let id = input.trim()
  const urlMatch = id.match(/michaelpage\.de\/job-detail\/([^?#]+)/i)
  if (urlMatch) {
    id = urlMatch[1]
  } else if (id.startsWith("/job-detail/")) {
    id = id.slice("/job-detail/".length)
  }
  id = id.split(/[?#]/)[0].replace(/\/+$/, "")
  if (!/^[^/]+\/ref\/[^/]+$/i.test(id)) return null
  return id
}

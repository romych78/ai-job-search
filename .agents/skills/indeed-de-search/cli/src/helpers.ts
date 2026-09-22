// Data source: de.indeed.com's public, unauthenticated search and detail pages.
// Both pages embed a JSON blob inline as `window.mosaic.providerData["<key>"]=...`;
// the detail page additionally embeds a schema.org JobPosting <script
// type="application/ld+json"> block. We prefer those structured blobs over HTML
// regex parsing wherever Indeed provides them (see parseSearchResults /
// parseJobDetail below) — only the detail description falls back to a raw
// div-by-id extraction if the JSON-LD block is ever missing.
//
// Personal use only. See SKILL.md for the robots.txt/anonymous-access caveats
// this CLI works within (search page 1 is fine; `detail` sits outside the
// robots.txt allowance for this User-Agent bucket; pagination beyond page 1
// requires a signed-in session and is not attempted).

export const BASE_URL = "https://de.indeed.com"
export const USER_AGENT = "Mozilla/5.0 (compatible; indeed-de-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404.
 *
 * Indeed redirects anonymous requests it doesn't want to serve (e.g. search
 * page 2+) to `secure.indeed.com/auth` (sign-in) or `onboarding.indeed.com`.
 * `fetch` follows that redirect silently and would otherwise hand back a
 * sign-in page that fails to parse with a confusing error — detect it here
 * and raise a clear, specific message instead.
 *
 * Also retries on 403 and on Cloudflare's "Security Check" managed-challenge
 * page: confirmed live, Indeed's Cloudflare bot-management intermittently
 * blocks legitimate, identical requests both ways — sometimes as an actual
 * HTTP 403 (observed even from plain curl with no automation markers),
 * sometimes as an HTTP 200 whose body is a JS challenge page instead of the
 * requested content (`window.INDEED_CLOUDFLARE_STATIC_PAGE = {...}`) — and
 * then serves the real page to the very next retry. Both are treated the
 * same as 429/5xx rather than a hard failure or, worse, silently parsed as
 * an empty result.
 */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })

    const retryStatus = response.status === 429 || response.status === 403 || response.status >= 500
    if (retryStatus) {
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
    if (response.url.includes("secure.indeed.com/auth") || response.url.includes("onboarding.indeed.com")) {
      throw new Error(
        "Indeed redirected this request to a sign-in page (secure.indeed.com/auth). " +
          "Anonymous/automated access beyond page 1 of search results is not available.",
      )
    }

    const body = await response.text()
    if (body.includes("INDEED_CLOUDFLARE_STATIC_PAGE")) {
      if (attempt === maxRetries) {
        throw new Error("Indeed served a Cloudflare security-check page instead of the requested content, after max retries.")
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    return body
  }
  throw new Error("Request failed after max retries")
}

/**
 * Indeed embeds each page's data as `window.mosaic.providerData["<key>"]={...}`
 * inline in a <script> tag. Extract and parse the JSON object for a given
 * provider key by tracking brace/string depth char-by-char — a plain regex
 * would stop at the first `}`, which routinely appears inside quoted HTML
 * snippets nested in the payload (e.g. job description fragments).
 */
export function extractProviderData(html: string, providerKey: string): any {
  const marker = `window.mosaic.providerData["${providerKey}"]=`
  const markerIdx = html.indexOf(marker)
  if (markerIdx === -1) return null
  const openIdx = html.indexOf("{", markerIdx + marker.length)
  if (openIdx === -1) return null

  let depth = 0
  let inStr = false
  let esc = false
  let i = openIdx
  for (; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
    } else {
      if (c === '"') inStr = true
      else if (c === "{") depth++
      else if (c === "}") {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
    }
  }
  const blob = html.slice(openIdx, i)
  try {
    return JSON.parse(blob)
  } catch {
    return null
  }
}

/**
 * Extract the inner HTML of the first element whose `id` or `class` attribute
 * contains `value`, tracking `<div>` nesting depth so a nested `</div>` inside
 * the target element doesn't truncate the extraction early.
 */
export function extractDivContent(html: string, attr: "id" | "class", value: string): string | null {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*${attr}="[^"]*${escaped}[^"]*"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return html.slice(open.index + open[0].length, i - 6)
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji) decode
 * correctly, and drops out-of-range values instead of throwing.
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Render a fragment of job-description HTML as readable plain text, keeping paragraph breaks. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  /** Indeed's own relative string (e.g. "vor 3 Tagen"), passed through as-is. */
  relativeDate: string | null
  url: string
}

export interface SearchPageResult {
  results: JobCard[]
}

/**
 * Parse the search-results page via the `mosaic-provider-jobcards` blob's
 * `metaData.mosaicProviderJobCardsModel.results` array — the same data the
 * page's React components render from, so nothing here depends on CSS class
 * names that Indeed could rename.
 */
export function parseSearchResults(html: string): SearchPageResult {
  const data = extractProviderData(html, "mosaic-provider-jobcards")
  const raw = data?.metaData?.mosaicProviderJobCardsModel?.results
  if (!Array.isArray(raw)) {
    throw new Error(
      "Could not locate job results in the Indeed search page — the page markup may have changed, " +
        "or the request landed on a sign-in/consent page instead of search results.",
    )
  }

  const results: JobCard[] = raw
    .map((r: any): JobCard => {
      const id = typeof r?.jobkey === "string" ? r.jobkey : ""
      const pub = typeof r?.pubDate === "number" ? r.pubDate : null
      return {
        id,
        title: typeof r?.displayTitle === "string" ? r.displayTitle : "",
        company: typeof r?.company === "string" && r.company ? r.company : null,
        companyUrl:
          typeof r?.companyOverviewLink === "string" && r.companyOverviewLink
            ? `${BASE_URL}${r.companyOverviewLink}`
            : null,
        location: typeof r?.formattedLocation === "string" && r.formattedLocation ? r.formattedLocation : null,
        date: pub ? new Date(pub).toISOString().slice(0, 10) : null,
        relativeDate:
          typeof r?.formattedRelativeTime === "string" && r.formattedRelativeTime ? r.formattedRelativeTime : null,
        url: id ? `${BASE_URL}/viewjob?jk=${id}` : "",
      }
    })
    .filter((c) => c.id && c.title)

  return { results }
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  deadline: string | null
  applyUrl: string | null
}

/**
 * Some listings — observed on sponsored/aggregated ("gesponsert") postings —
 * render without the JSON-LD block at all. They still carry their data as
 * plain `"key":"value"` string literals inside a minified JS bundle (not a
 * clean top-level blob), so a full structured extraction isn't practical.
 * This targets one field at a time via its literal JSON-string key, which is
 * robust to that surrounding bundle changing shape. The wrap-in-quotes +
 * JSON.parse decodes the JS-source `/`-style escapes back to plain text
 * (a bare regex would leave `/` untouched instead of `/`).
 */
function extractJsonStringField(html: string, key: string): string | null {
  const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return null
  try {
    const value = JSON.parse(`"${m[1]}"`)
    return typeof value === "string" && value ? value : null
  } catch {
    return null
  }
}

/**
 * Parse the detail page primarily via its embedded schema.org
 * `<script type="application/ld+json">` JobPosting block — a stable,
 * Google-for-Jobs-mandated structured format that's far less likely to break
 * than the page's CSS classes. Falls back to the `#jobDescriptionText` div
 * for the description, and to literal `companyName`/`companyOverviewLink`/
 * `formattedLocation` string fields (see extractJsonStringField) for company
 * and location, in case a posting ever omits the JSON-LD block entirely.
 */
export function parseJobDetail(html: string, id: string): JobDetail {
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
  let ld: any = null
  if (ldMatch) {
    try {
      ld = JSON.parse(ldMatch[1])
    } catch {
      ld = null
    }
  }

  let title: string | null = typeof ld?.title === "string" ? ld.title : null
  if (!title) {
    const h1 = html.match(/class="jobsearch-JobInfoHeader-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
    title = h1 ? decodeHtmlEntities(stripTags(h1[1])) || null : null
  }

  let company: string | null = typeof ld?.hiringOrganization?.name === "string" ? ld.hiringOrganization.name : null
  let companyUrl: string | null = null
  if (!company) {
    company = extractJsonStringField(html, "companyName")
    const link = extractJsonStringField(html, "companyOverviewLink")
    companyUrl = link ? link.split("?")[0] : null
  }

  let location: string | null = null
  const addr = ld?.jobLocation?.address
  if (addr && typeof addr === "object") {
    location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ") || null
  }
  if (!location) {
    location = extractJsonStringField(html, "formattedLocation")
  }

  const date = typeof ld?.datePosted === "string" ? ld.datePosted.slice(0, 10) : null
  const deadline = typeof ld?.validThrough === "string" ? ld.validThrough.slice(0, 10) : null
  const employmentType = Array.isArray(ld?.employmentType)
    ? ld.employmentType.join(", ") || null
    : typeof ld?.employmentType === "string"
      ? ld.employmentType
      : null

  let description: string | null = null
  if (typeof ld?.description === "string") {
    description = htmlToText(ld.description) || null
  }
  if (!description) {
    const fallback = extractDivContent(html, "id", "jobDescriptionText")
    if (fallback) description = htmlToText(fallback) || null
  }

  return {
    id,
    title: title ?? "(untitled)",
    company,
    companyUrl,
    location,
    date,
    relativeDate: null,
    url: `${BASE_URL}/viewjob?jk=${id}`,
    description,
    employmentType,
    deadline,
    applyUrl: null,
  }
}

/** Convert a job-age in days to Indeed's `fromage` parameter. `null` means "no filter". */
export function jobageToFromage(days: number): string | null {
  if (!days || days <= 0 || days >= 9999) return null
  return String(days)
}

// Data source: the Bundesagentur für Arbeit's public "Jobsuche" REST API
// (rest.arbeitsagentur.de/jobboerse/jobsuche-service) — JSON, no HTML scraping.
// This is the same API the official jobboerse.arbeitsagentur.de web app and its
// mobile app call. It is documented (openapi.yaml) by the community bundesAPI
// project: https://github.com/bundesAPI/jobsuche-api and https://jobsuche.api.bund.dev/
//
// Auth: a fixed "X-API-Key: jobboerse-jobsuche" header. This is NOT a personal
// secret/credential — it is a single public clientId hardcoded into BA's own
// official frontend JavaScript (visible to anyone opening devtools on
// jobboerse.arbeitsagentur.de) and published openly in BA's own OpenAPI spec.
// It is treated here as a fixed constant (like a User-Agent string), never as
// an environment-variable credential per the portal-skill contract's Step 2.5
// rule — that rule is for *personal* API keys a user must obtain, not a public
// constant every caller shares.
//
// Search uses /pc/v6/jobs; detail uses /pc/v4/jobdetails/{base64(refnr)} — the
// analogous /pc/v4/jobs and /pc/v6/jobdetails paths returned 403 in live
// testing (2026-09-04), so the two API versions are intentionally mixed here.

export const BASE_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service"
export const SEARCH_PATH = "/pc/v6/jobs"
export const DETAIL_PATH = "/pc/v4/jobdetails"
export const PUBLIC_DETAIL_BASE = "https://www.arbeitsagentur.de/jobsuche/jobdetail"

// Public, non-secret client identifier — see the file-header note above.
const API_KEY = "jobboerse-jobsuche"
const UA = "Mozilla/5.0 (compatible; arbeitsagentur-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * GET JSON from the Jobsuche API with exponential backoff on 429/5xx (max 6
 * retries). Returns `null` on a 404 (job not found) instead of throwing.
 */
export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  let url = `${BASE_URL}${path}`
  if (params && Object.keys(params).length > 0) {
    url += `?${new URLSearchParams(params).toString()}`
  }

  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "X-API-Key": API_KEY, Accept: "application/json", "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the Jobsuche API (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Jobsuche API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Jobsuche API request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Jobsuche API request failed after max retries")
}

// --- Response shapes (only the fields this CLI reads; the API returns more) ---

interface Adresse {
  plz?: string
  ort?: string
  region?: string
  land?: string
}

interface Stellenlokation {
  adresse?: Adresse
}

export interface RawJob {
  referenznummer: string
  stellenangebotsTitel?: string
  firma?: string
  stellenlokationen?: Stellenlokation[]
  datumErsteVeroeffentlichung?: string
  externeURL?: string
  homeofficemoeglich?: boolean
  arbeitszeitVollzeit?: boolean
  verguetungsangabe?: string
  gehaltsspanneVon?: number
  gehaltsspanneBis?: number
  vertragsdauer?: string
}

export interface RawJobDetail extends RawJob {
  stellenangebotsBeschreibung?: string
}

export interface SearchResponse {
  ergebnisliste?: RawJob[]
  maxErgebnisse?: number
  page?: number
  size?: number
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
  homeOfficePossible: boolean | null
  fullTime: boolean | null
  contractType: string | null
  salaryFrom: number | null
  salaryTo: number | null
}

/** Rough capitalization for the API's all-caps land/region values (e.g. "OESTERREICH" -> "Oesterreich"). */
function titleCase(s: string): string {
  return s.length ? s[0] + s.slice(1).toLowerCase() : s
}

/** Build a human-readable location string from a job's first location entry. */
export function formatLocation(job: RawJob): string | null {
  const adresse = job.stellenlokationen?.[0]?.adresse
  if (!adresse) return null
  const parts: string[] = []
  if (adresse.ort) parts.push(adresse.ort)
  if (adresse.land && adresse.land.toUpperCase() !== "DEUTSCHLAND") {
    parts.push(titleCase(adresse.land))
  }
  if (parts.length) return parts.join(", ")
  return adresse.region ? titleCase(adresse.region) : null
}

function detailUrl(refnr: string): string {
  return `${PUBLIC_DETAIL_BASE}/${encodeURIComponent(refnr)}`
}

export function toJobCard(job: RawJob): JobCard {
  return {
    id: job.referenznummer,
    title: job.stellenangebotsTitel || "(untitled)",
    company: job.firma || null,
    location: formatLocation(job),
    date: job.datumErsteVeroeffentlichung || null,
    url: job.externeURL || detailUrl(job.referenznummer),
  }
}

export function parseSearchResponse(body: SearchResponse | null): { jobs: JobCard[]; total: number } {
  const list = body?.ergebnisliste || []
  return { jobs: list.map(toJobCard), total: body?.maxErgebnisse ?? list.length }
}

/**
 * Clean the API's plain-text job description: it is not HTML (no tags to
 * strip, no entities to decode in practice), but it does use non-breaking
 * spaces and, for some employers' submissions, hard-wrapped single newlines
 * with no paragraph structure. We normalize whitespace conservatively and
 * leave the source's own line breaks intact rather than guessing at
 * paragraph boundaries that aren't actually present in the data.
 */
export function cleanDescription(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function toJobDetail(job: RawJobDetail): JobDetail {
  const card = toJobCard(job)
  return {
    ...card,
    description: job.stellenangebotsBeschreibung ? cleanDescription(job.stellenangebotsBeschreibung) : null,
    homeOfficePossible: typeof job.homeofficemoeglich === "boolean" ? job.homeofficemoeglich : null,
    fullTime: typeof job.arbeitszeitVollzeit === "boolean" ? job.arbeitszeitVollzeit : null,
    contractType: job.vertragsdauer || null,
    salaryFrom: typeof job.gehaltsspanneVon === "number" ? job.gehaltsspanneVon : null,
    salaryTo: typeof job.gehaltsspanneBis === "number" ? job.gehaltsspanneBis : null,
  }
}

/** Extract a referenznummer from a bare id, a jobsuche/jobdetail URL, or any URL containing one as the last path segment. */
export function normalizeId(input: string): string {
  const m = input.match(/\/jobdetail\/([^/?#]+)/)
  if (m) return decodeURIComponent(m[1])
  // Any other URL: fall back to the last non-empty path segment.
  if (/^https?:\/\//i.test(input)) {
    const parts = input.split(/[/?#]/).filter(Boolean)
    return decodeURIComponent(parts[parts.length - 1] || input)
  }
  return input.trim()
}

export function refnrToDetailPath(refnr: string): string {
  const encoded = Buffer.from(refnr, "utf-8").toString("base64")
  return `${DETAIL_PATH}/${encoded}`
}

/** Days-since-posted filter, clamped to the API's documented 0-100 day range. */
export function clampJobage(days: number): number {
  return Math.max(0, Math.min(100, days))
}

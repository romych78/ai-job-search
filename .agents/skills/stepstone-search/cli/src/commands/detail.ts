import { BASE_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept a bare numeric job ID, a full detail URL (any descriptive slug — the
 * slug is cosmetic, only the trailing `--<id>-inline.html` is load-bearing), or
 * any URL/string containing that suffix.
 */
function normalizeId(input: string): string | null {
  const suffix = input.match(/-(\d{5,})-inline\.html/)
  if (suffix) return suffix[1]
  const bare = input.match(/^\d{5,}$/)
  if (bare) return input
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // The descriptive part of the slug is cosmetic (confirmed live — StepStone
    // resolves the page from the trailing id regardless of what precedes it),
    // so a synthetic minimal slug avoids depending on a caller-supplied one.
    const html = await htmlFetch(`${BASE_URL}/stellenangebote--job--${id}-inline.html`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Contract: ${job.employmentType}` : "",
        job.workType ? `Work mode: ${job.workType}` : "",
        job.date ? `Posted: ${job.date}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

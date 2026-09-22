import { DETAIL_BASE, textFetch, parseJobDetail, normalizeId, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a landing.jobs posting id from "${opts.id}". Pass the "id" field from ` +
        `a search result (e.g. "we-are-meta/staff-python-engineer") or the full landing.jobs/at/... URL.`,
      "BAD_ID",
    )
    return 1
  }
  const [companySlug, jobSlug] = id.split("/")
  try {
    const html = await textFetch(`${DETAIL_BASE}/${id}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, companySlug, jobSlug)
    if (!job) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.remoteLabel ? `Remote: ${job.remoteLabel}` : "",
        job.category ? `Category: ${job.category}` : "",
        job.experienceLevel ? `Experience: ${job.experienceLevel}` : "",
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

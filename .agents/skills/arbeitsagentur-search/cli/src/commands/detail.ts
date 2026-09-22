import {
  apiGet,
  normalizeId,
  refnrToDetailPath,
  toJobDetail,
  writeError,
  type RawJobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const refnr = normalizeId(opts.id)
  if (!refnr) {
    writeError(`Could not parse a job reference number from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const raw = await apiGet<RawJobDetail>(refnrToDetailPath(refnr))
    if (!raw) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    // The detail endpoint doesn't always echo referenznummer back; the id we
    // requested with is authoritative for building the public detail URL.
    const job = toJobDetail({ ...raw, referenznummer: raw.referenznummer || refnr })

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.fullTime === true ? "Employment: Vollzeit (full-time)" : job.fullTime === false ? "Employment: Teilzeit (part-time)" : "",
        job.contractType ? `Contract: ${job.contractType}` : "",
        job.homeOfficePossible === true ? "Home office: possible" : "",
        job.salaryFrom !== null || job.salaryTo !== null
          ? `Salary: ${job.salaryFrom ?? "?"}–${job.salaryTo ?? "?"} EUR/year`
          : "",
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

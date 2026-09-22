import { BASE_URL, htmlFetch, isExternalListing, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Unlike StepStone/LinkedIn (numeric ID alone is enough), meinestadt's detail
 * URL is `/<city-slug>/{premium|standard}?id=<id>` — the city is load-bearing,
 * not cosmetic, so a bare numeric ID can't be turned into a fetchable URL on
 * its own. This CLI requires the full URL a `search` result already provides.
 */
function normalizeUrl(input: string): { url: string; id: string } | { error: string } {
  if (/^\d+$/.test(input)) {
    return {
      error:
        `"${input}" is a bare job ID, but meinestadt.de's detail URL requires the originating city ` +
        `(e.g. https://jobs.meinestadt.de/frankfurt-am-main/premium?id=${input}). Pass the full "url" ` +
        "field from a `search` result instead — see SKILL.md.",
    }
  }
  const idMatch = input.match(/[?&]id=(\d+)/)
  if (!idMatch || !/^https:\/\/(jobs|www)\.meinestadt\.de\//.test(input)) {
    return { error: `Could not parse a meinestadt.de detail URL from "${input}"` }
  }
  return { url: input, id: idMatch[1] }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const parsed = normalizeUrl(opts.id)
  if ("error" in parsed) {
    writeError(parsed.error, "BAD_ID")
    return 1
  }
  const { url, id } = parsed

  // The partner "apply" redirect wrapper is robots.txt-disallowed
  // (`Disallow: /redirect/` on jobs.meinestadt.de; `Disallow: /*?*redirectUrl`
  // on www.meinestadt.de, where it actually resolves) — this CLI refuses to
  // fetch it rather than silently violating robots.txt. See url-reference.md.
  if (isExternalListing(url)) {
    writeError(
      "This is a partner \"apply\" redirect link, not a meinestadt.de-hosted listing. Fetching it is " +
        "disallowed by robots.txt (`Disallow: /redirect/` / `Disallow: /*?*redirectUrl`) — `detail` only " +
        "works on native premium/standard listings. See SKILL.md.",
      "EXTERNAL_LISTING",
    )
    return 1
  }
  if (!url.startsWith(BASE_URL)) {
    writeError(`Only jobs.meinestadt.de detail URLs are supported, got "${url}"`, "BAD_ID")
    return 1
  }

  try {
    const html = await htmlFetch(url)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id, url)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Employment type: ${job.employmentType}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.deadline ? `Deadline: ${job.deadline}` : "",
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

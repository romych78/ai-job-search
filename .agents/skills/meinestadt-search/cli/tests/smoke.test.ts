import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke test against jobs.meinestadt.de. Per the repo's portal-skill
// contract (Step 4 of /add-portal) this hits the real network a handful of
// times per run (category-index + category-sitemap + listing page for
// search, plus one detail fetch) — keep it that way, don't add more live
// calls here.
//
// "CTO" (an English abbreviation) has no match in meinestadt's German
// occupation taxonomy, so the live-data assertions use "Geschäftsführer"
// instead — see SKILL.md's Notes on why free-text English queries routinely
// return zero results on this portal.

interface SearchResult {
  id: string | null;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
  isExternal: boolean;
}

interface SearchEnvelope {
  meta: { count: number; page: number; total: number; note?: string };
  results: SearchResult[];
}

interface DetailResult extends SearchResult {
  description: string | null;
}

describe("live: search", () => {
  test("a real German category query returns real, non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "Geschäftsführer", "--limit", "5", "--format", "json"]);
    const body = parseJSON<SearchEnvelope>(result);

    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toContain("meinestadt.de/");
    }
  }, 30000);

  test("an English query with no taxonomy match returns zero results, not an error", async () => {
    const result = await runCLI(["search", "-q", "CTO", "--format", "json"]);
    const body = parseJSON<SearchEnvelope>(result);
    expect(body.results).toEqual([]);
    expect(body.meta.count).toBe(0);
    expect(body.meta.note).toBeTruthy();
  }, 30000);

  test("detail on the first live native (non-external) result returns a readable description", async () => {
    const searchResult = await runCLI(["search", "-q", "Geschäftsführer", "--limit", "20", "--format", "json"]);
    const body = parseJSON<SearchEnvelope>(searchResult);
    const native = body.results.find((r) => !r.isExternal);
    expect(native).toBeTruthy();

    const detailResult = await runCLI(["detail", native!.url, "--format", "json"]);
    const job = parseJSON<DetailResult>(detailResult);
    expect(job.title).toBeTruthy();
    expect(job.description).toBeTruthy();
    expect((job.description || "").length).toBeGreaterThan(50);
  }, 30000);
});

describe("offline: bad input contract", () => {
  test("a bogus flag value exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "Geschäftsführer", "--limit", "not-a-number"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ARG");
  });

  test("detail with no url exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("NO_ID");
  });
});

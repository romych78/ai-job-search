import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke test against www.stepstone.de. Per the repo's portal-skill contract
// (Step 4 of /add-portal) this hits the real network exactly twice per test
// run — one search, one detail fetched from a search result — keep it that way;
// don't add more live calls here.

interface SearchResult {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
}

interface SearchEnvelope {
  meta: { count: number; page: number; total: number };
  results: SearchResult[];
}

interface DetailResult extends SearchResult {
  description: string | null;
}

describe("live: search", () => {
  test("a real query returns real, non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "CTO", "--limit", "5", "--format", "json"]);
    const body = parseJSON<SearchEnvelope>(result);

    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toContain("stepstone.de/stellenangebote--");
    }
  }, 30000);

  test("detail on the first live result returns a readable description", async () => {
    const searchResult = await runCLI(["search", "-q", "CTO", "--limit", "1", "--format", "json"]);
    const body = parseJSON<SearchEnvelope>(searchResult);
    expect(body.results.length).toBeGreaterThan(0);
    const id = body.results[0].id;

    const detailResult = await runCLI(["detail", id, "--format", "json"]);
    const job = parseJSON<DetailResult>(detailResult);
    expect(job.title).toBeTruthy();
    expect(job.description).toBeTruthy();
    expect((job.description || "").length).toBeGreaterThan(50);
  }, 30000);
});

describe("offline: bad input contract", () => {
  test("a bogus flag value exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "CTO", "--limit", "not-a-number"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("BAD_ARG");
  });

  test("detail with no id exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = JSON.parse(result.stderr);
    expect(err.code).toBe("NO_ID");
  });
});

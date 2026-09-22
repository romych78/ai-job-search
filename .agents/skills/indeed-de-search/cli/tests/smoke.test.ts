import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke test against de.indeed.com. Per the repo's portal-skill contract
// (Step 4 of /add-portal) this hits the real network exactly once per test
// run — keep it that way; don't add more live calls here. Detail is verified
// manually during Step 4 rather than in CI-run tests, to avoid hitting the
// robots.txt-restricted /viewjob? endpoint on every test run.

interface SearchResult {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
}

interface SearchEnvelope {
  meta: { count: number; page: number };
  results: SearchResult[];
}

describe("live: search", () => {
  test("a real query returns real, non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "CTO", "-l", "Deutschland", "--limit", "5", "--format", "json"]);
    const body = parseJSON<SearchEnvelope>(result);

    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toContain("de.indeed.com/viewjob?jk=");
    }
  }, 30000);
});

describe("offline: bad input contract", () => {
  test("a bogus flag value exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "--jobage", "not-a-number"]);
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

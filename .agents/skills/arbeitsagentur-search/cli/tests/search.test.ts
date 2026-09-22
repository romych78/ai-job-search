import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

interface JobCard {
  id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string | null;
}

interface SearchResult {
  meta: { count: number; page: number; total: number };
  results: JobCard[];
}

// Live smoke tests against the real Jobsuche API. Keep volume low (add-portal.md
// Step 4.6 / this skill's personal-use note) — a small, fixed number of calls.
describe("arbeitsagentur CLI live search", () => {
  test("search for 'CTO' returns real results with non-null id/title/url", async () => {
    const result = await runCLI(["search", "-q", "CTO", "--limit", "5"]);
    const body = parseJSON<SearchResult>(result);
    expect(result.exitCode).toBe(0);
    expect(body.results.length).toBeGreaterThan(0);
    const first = body.results[0];
    expect(first.id).toBeTruthy();
    expect(first.title).toBeTruthy();
    expect(first.url).toBeTruthy();
  }, 30000);

  test("detail fetches a real posting from a live search result", async () => {
    const searchResult = await runCLI(["search", "-q", "CTO", "--limit", "1"]);
    const body = parseJSON<SearchResult>(searchResult);
    const id = body.results[0].id as string;

    const detailResult = await runCLI(["detail", id]);
    expect(detailResult.exitCode).toBe(0);
    const detail = parseJSON<JobCard & { description: string | null }>(detailResult);
    expect(detail.title).toBeTruthy();
    expect(detail.description).toBeTruthy();
  }, 30000);
});

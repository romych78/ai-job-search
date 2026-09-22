import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Offline checks (no network) — flag validation and required-arg guards must
// fail fast, before any request is made.
describe("landing.jobs CLI error contract (offline)", () => {
  test("detail without an id fails before making a request", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "detail requires an <id|url>",
      code: "NO_ID",
    });
  });

  test("a non-numeric --page value fails before making a request", async () => {
    const result = await runCLI(["search", "--query", "python", "--page", "not-a-number"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_ARG");
  });

  test("an unresolvable detail id (no company/job slug pair) fails before making a request", async () => {
    const result = await runCLI(["detail", "not-a-valid-id"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_ID");
  });

  test("an unknown command fails", async () => {
    const result = await runCLI(["bogus-command"]);
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_CMD");
  });
});

// Live smoke tests — real requests against landing.jobs's public sitemap and
// job-detail pages. Kept to a minimum per the repo's low-volume convention.
//
// Note: "python" is used here rather than "CTO" (the profile's realistic test
// query) because landing.jobs's live inventory at the time this skill was
// built skews toward individual-contributor engineering roles — a live check
// found zero postings matching "CTO", "VP Engineering", or "Engineering
// Manager" (see url-reference.md). That's a genuine empty result, not a
// parsing bug, but it can't demonstrate the parsing pipeline actually works on
// real data, so the smoke test uses a query known to return results.
describe("landing.jobs CLI live smoke test", () => {
  test("search returns real, non-garbled results", async () => {
    const result = await runCLI(["search", "-q", "python", "--limit", "5", "--format", "json"]);
    const body = parseJSON<{ meta: { count: number; page: number }; results: any[] }>(result);

    expect(body.results.length).toBeGreaterThan(0);
    const first = body.results[0];
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.title).not.toMatch(/<[a-z]+>/i); // no leaked HTML tags
    expect(typeof first.url).toBe("string");
    expect(first.url).toContain("landing.jobs/at/");
  }, 30000);

  test("detail resolves a real search result to its full description", async () => {
    const searchResult = await runCLI(["search", "-q", "python", "--limit", "1", "--format", "json"]);
    const searchBody = parseJSON<{ results: any[] }>(searchResult);
    const id = searchBody.results[0].id as string;

    const detailResult = await runCLI(["detail", id, "--format", "json"]);
    const job = parseJSON<{ title: string; description: string | null; url: string }>(detailResult);

    expect(job.title.length).toBeGreaterThan(0);
    expect(job.url).toContain(id);
    expect(job.description === null || job.description.length > 0).toBe(true);
    if (job.description) {
      expect(job.description).not.toMatch(/<[a-z]+>/i); // tags stripped
      expect(job.description).not.toContain("&lt;"); // double-escaped entities decoded
    }
  }, 30000);

  test("a query with no live matches (CTO) returns zero results, not an error", async () => {
    const result = await runCLI(["search", "-q", "CTO", "--format", "json"]);
    const body = parseJSON<{ meta: { count: number }; results: any[] }>(result);
    expect(body.results).toEqual([]);
  }, 30000);
});

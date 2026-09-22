import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Offline checks (no network) — flag validation and required-arg guards must
// fail fast, before any request is made.
describe("Michael Page CLI error contract (offline)", () => {
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
    const result = await runCLI(["search", "--query", "CTO", "--page", "not-a-number"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("BAD_ARG");
  });

  test("an unresolvable detail id (no /ref/ segment) fails before making a request", async () => {
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

// Live smoke tests — real requests against Michael Page's public job search.
// Kept to a minimum (one search, one detail) per the repo's low-volume
// convention.
describe("Michael Page CLI live smoke test", () => {
  test("search returns real, non-garbled results", async () => {
    const result = await runCLI(["search", "-q", "CTO", "--limit", "5", "--format", "json"]);
    const body = parseJSON<{ meta: { count: number; page: number }; results: any[] }>(result);

    expect(body.results.length).toBeGreaterThan(0);
    const first = body.results[0];
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);
    expect(first.id).toContain("/ref/");
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.title).not.toMatch(/<[a-z]+>/i); // no leaked HTML tags
    expect(typeof first.url).toBe("string");
    expect(first.url).toContain("michaelpage.de/job-detail/");
  }, 30000);

  test("detail resolves a real search result to its full description", async () => {
    const searchResult = await runCLI(["search", "-q", "CTO", "--limit", "1", "--format", "json"]);
    const searchBody = parseJSON<{ results: any[] }>(searchResult);
    const id = searchBody.results[0].id as string;

    const detailResult = await runCLI(["detail", id, "--format", "json"]);
    const job = parseJSON<{ title: string; description: string | null; url: string }>(detailResult);

    expect(job.title.length).toBeGreaterThan(0);
    expect(job.url).toContain("michaelpage.de/job-detail/");
    expect(job.description === null || job.description.length > 0).toBe(true);
    if (job.description) {
      expect(job.description).not.toMatch(/<[a-z]+>/i); // tags stripped
    }
  }, 30000);
});

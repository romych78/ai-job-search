import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("StepStone CLI flag validation", () => {
  describe("search without --query", () => {
    test("exits 1 with NO_QUERY, without making a request", async () => {
      const result = await runCLI(["search"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_QUERY");
    });
  });

  describe("--jobage (unsupported)", () => {
    test("any value exits 1 with JOBAGE_UNSUPPORTED, without making a request", async () => {
      const result = await runCLI(["search", "-q", "CTO", "--jobage", "7"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("JOBAGE_UNSUPPORTED");
      expect(err.error).toMatch(/robots\.txt/i);
    });

    test("non-numeric value exits 1 with BAD_ARG (checked before the unsupported check)", async () => {
      const result = await runCLI(["search", "-q", "CTO", "--jobage", "foo"]);
      expect(result.exitCode).toBe(1);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
    });
  });

  describe("--page > 1 (pagination unsupported)", () => {
    test("page 2 exits 1 with PAGINATION_UNSUPPORTED, without making a request", async () => {
      const result = await runCLI(["search", "-q", "CTO", "--page", "2"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("PAGINATION_UNSUPPORTED");
      expect(err.error).toMatch(/robots\.txt/i);
    });

    test("non-numeric value exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "CTO", "--page", "abc"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/page/);
    });
  });

  describe("--limit NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "CTO", "--limit", "xyz"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/limit/);
    });
  });

  describe("detail without an id", () => {
    test("exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).toBe(1);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_ID");
    });
  });

  describe("detail with an unparseable id", () => {
    test("exits 1 with BAD_ID, without making a request", async () => {
      const result = await runCLI(["detail", "not-a-valid-id"]);
      expect(result.exitCode).toBe(1);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ID");
    });
  });

  describe("unknown command", () => {
    test("exits 1 with BAD_CMD", async () => {
      const result = await runCLI(["bogus"]);
      expect(result.exitCode).toBe(1);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_CMD");
    });
  });
});

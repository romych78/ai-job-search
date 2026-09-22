import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("arbeitsagentur CLI flag validation (network-free)", () => {
  test("no command prints help and exits 1", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });

  test("a bogus --flag exits 1 with UNKNOWN_FLAG instead of being silently discarded", async () => {
    const result = await runCLI(["search", "-q", "test", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsedStderr(result.stderr).code).toBe("UNKNOWN_FLAG");
  });

  test("detail with no id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  describe("--jobage validation (0-100 range)", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "test", "--jobage", "foo"]);
      expect(result.exitCode).toBe(1);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
    });

    test("fractional value exits 1 with BAD_ARG instead of truncating", async () => {
      const result = await runCLI(["search", "-q", "test", "--jobage", "1.5"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("value above 100 (API's documented max) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "test", "--jobage", "101"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("negative value is parsed as a missing value and exits 1 with UNKNOWN_FLAG", async () => {
      // parseFlags treats a next-token starting with "-" as absent, so "-5"
      // never reaches --jobage as a value; it parses as a stray flag named
      // "5", which the unknown-flag guard rejects before the range check can.
      // Either way a negative value fails loudly, never a silent unfiltered search.
      const result = await runCLI(["search", "-q", "test", "--jobage", "-5"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("UNKNOWN_FLAG");
    });
  });

  describe("--page / --limit validation", () => {
    test("--page 0 exits 1 with BAD_ARG (1-indexed)", async () => {
      const result = await runCLI(["search", "-q", "test", "--page", "0"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("--limit 0 exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "test", "--limit", "0"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("--limit non-numeric exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "test", "--limit", "xyz"]);
      expect(result.exitCode).toBe(1);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });
});

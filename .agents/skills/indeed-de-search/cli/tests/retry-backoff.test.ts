import { afterEach, describe, expect, test } from "bun:test";
import { htmlFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// fires immediately so the exhaustion case does not sleep through the real
// 500ms -> 8s backoff schedule.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) =>
    originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

describe("htmlFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response("<html>ok</html>", { status: 200 }),
    ]);

    const html = await htmlFetch("https://de.indeed.com/jobs?q=x");
    expect(html).toContain("ok");
    expect(state.calls).toBe(2);
  });

  test("retries a 403 and succeeds on the next attempt (Cloudflare bot-check flake, confirmed live)", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 403 }),
      () => new Response("<html>ok</html>", { status: 200 }),
    ]);

    const html = await htmlFetch("https://de.indeed.com/viewjob?jk=x");
    expect(html).toContain("ok");
    expect(state.calls).toBe(2);
  });

  test("returns the documented empty string on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);

    const html = await htmlFetch("https://de.indeed.com/viewjob?jk=x");
    expect(html).toBe("");
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(htmlFetch("https://de.indeed.com/jobs?q=x")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
  });

  test("retries a 200 that's actually a Cloudflare challenge page (confirmed live)", async () => {
    instantTimers();
    const challenge = `<html><script>window.INDEED_CLOUDFLARE_STATIC_PAGE={PAGE_TYPE:"captcha"};</script></html>`;
    const state = stubFetch([
      () => new Response(challenge, { status: 200 }),
      () => new Response("<html>real job content</html>", { status: 200 }),
    ]);

    const html = await htmlFetch("https://de.indeed.com/viewjob?jk=x");
    expect(html).toContain("real job content");
    expect(state.calls).toBe(2);
  });

  test("gives up after max retries on a persistent Cloudflare challenge page", async () => {
    instantTimers();
    const challenge = `<html><script>window.INDEED_CLOUDFLARE_STATIC_PAGE={PAGE_TYPE:"captcha"};</script></html>`;
    const state = stubFetch([() => new Response(challenge, { status: 200 })]);

    await expect(htmlFetch("https://de.indeed.com/viewjob?jk=x")).rejects.toThrow(/security-check/i);
    expect(state.calls).toBe(7);
  });

  test("raises a clear error when redirected to Indeed's sign-in page", async () => {
    // Simulate `redirect: "follow"` landing on secure.indeed.com/auth by
    // building a Response whose `.url` reflects the post-redirect location
    // (fetch() sets this after following redirects; we fake it directly here).
    globalThis.fetch = (async () => {
      const res = new Response("<html>sign in</html>", { status: 200 });
      Object.defineProperty(res, "url", {
        value: "https://secure.indeed.com/auth?co=DE&continue=...",
      });
      return res;
    }) as unknown as typeof fetch;

    await expect(htmlFetch("https://de.indeed.com/jobs?q=x&start=10")).rejects.toThrow(/sign-in/i);
  });
});

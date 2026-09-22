import { describe, test, expect } from "bun:test";
import {
  slugify,
  buildSearchUrl,
  extractResultlistState,
  extractJobAdProps,
  parseSearchResults,
  parseJobDetail,
} from "../src/helpers";

describe("slugify / buildSearchUrl", () => {
  test("lowercases and hyphenates a multi-word query", () => {
    expect(slugify("Data Engineer")).toBe("data-engineer");
    expect(slugify("  CTO  ")).toBe("cto");
  });

  test("keeps German umlauts and ß", () => {
    expect(slugify("Projektmanager München")).toBe("projektmanager-münchen");
  });

  test("falls back to a placeholder slug for an empty/symbol-only query", () => {
    expect(slugify("???")).toBe("suche");
  });

  test("builds the one allowed URL shape: /jobs/<slug>?q=<query>, nothing else", () => {
    const url = buildSearchUrl("data engineer münchen");
    expect(url).toBe("https://www.stepstone.de/jobs/data-engineer-münchen?q=data%20engineer%20m%C3%BCnchen");
    // Never more than the `q` parameter — robots.txt disallows a second one.
    expect(url.split("?")[1]?.startsWith("q=")).toBe(true);
    expect(url.match(/&/)).toBeNull();
  });
});

function resultlistFixture(items: unknown[], total?: number): string {
  const blob = {
    searchResults: {
      items,
      meta: { total: total ?? items.length },
    },
  };
  // Embed a nested-brace snippet inside a string field to exercise the
  // depth-tracking extractor — a naive regex would stop at the first "}" it
  // sees inside this snippet.
  return `<html><body><script>
window.__PRELOADED_STATE__ = window.__PRELOADED_STATE__ || {};
window.__PRELOADED_STATE__["app-unifiedResultlist"] = ${JSON.stringify(blob)};
window.__PRELOADED_STATE__.header = {"unrelated": true};
</script></body></html>`;
}

describe("extractResultlistState", () => {
  test("extracts the strict-JSON search-results blob", () => {
    const html = resultlistFixture([]);
    const state = extractResultlistState(html);
    expect(state.searchResults.items).toEqual([]);
  });

  test("does not truncate on nested braces inside quoted strings", () => {
    const html = `<script>window.__PRELOADED_STATE__["app-unifiedResultlist"] = ${JSON.stringify(
      { searchResults: { items: [], meta: { total: 0 }, note: "a { b } c { d } e" } },
    )};</script>`;
    const state = extractResultlistState(html);
    expect(state.searchResults.note).toBe("a { b } c { d } e");
  });

  test("returns null when the marker is absent", () => {
    expect(extractResultlistState("<html><body>no state here</body></html>")).toBeNull();
  });
});

describe("parseSearchResults", () => {
  test("maps id/title/companyName/location/datePosted/url/textSnippet", () => {
    const html = resultlistFixture(
      [
        {
          id: 14030156,
          title: "Field CTO Rubrik (m/w/d)",
          companyName: "operational services GmbH & Co. KG",
          companyUrl: "https://www.stepstone.de/cmp/de/operational-services-gmbh-72471/jobs",
          location: "Frankfurt am Main, Berlin",
          datePosted: "2026-08-03T00:19:44+02:00",
          url: "/stellenangebote--Field-CTO-Rubrik-14030156-inline.html?rltr=1_1_25_seorl_m_0_0_0_0_1_0",
          // Real payloads carry plain UTF-8 text here (StepStone's JSON isn't
          // HTML-escaped) — decodeHtmlEntities is defensive, not load-bearing.
          textSnippet: "operational services (OS) ist einer der führenden ICT Service Provider",
        },
      ],
      324,
    );
    const { total, results } = parseSearchResults(html);
    expect(total).toBe(324);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.id).toBe("14030156");
    expect(r.title).toBe("Field CTO Rubrik (m/w/d)");
    expect(r.company).toBe("operational services GmbH & Co. KG");
    expect(r.location).toBe("Frankfurt am Main, Berlin");
    expect(r.date).toBe("2026-08-03");
    // Tracking query string stripped, base URL prepended.
    expect(r.url).toBe("https://www.stepstone.de/stellenangebote--Field-CTO-Rubrik-14030156-inline.html");
    expect(r.snippet).toContain("führenden");
  });

  test("drops entries missing an id or title", () => {
    const html = resultlistFixture([
      { id: "", title: "No id" },
      { id: 1, title: "" },
      { id: 2, title: "Valid Title" },
    ]);
    const { results } = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("2");
  });

  test("nulls out missing optional fields rather than omitting them", () => {
    const html = resultlistFixture([{ id: 1, title: "Bare Minimum" }]);
    const { results } = parseSearchResults(html);
    const r = results[0];
    expect(r.company).toBeNull();
    expect(r.companyUrl).toBeNull();
    expect(r.location).toBeNull();
    expect(r.date).toBeNull();
    expect(r.snippet).toBeNull();
  });

  test("throws a clear error when the resultlist state is missing", () => {
    const html = "<html><body>Cloudflare challenge or unexpected markup</body></html>";
    expect(() => parseSearchResults(html)).toThrow(/markup/i);
  });
});

function detailPageFixture(props: Record<string, unknown>): string {
  return `<html><body><script>
window.__PRELOADED_STATE__ = window.__PRELOADED_STATE__ || {};
window.__PRELOADED_STATE__.header = {
        props: {"unrelated": "header block, appears before JobAdContent"}
      };
window.__PRELOADED_STATE__.JobAdContent = {
        props: ${JSON.stringify(props)}
      };
window.__PRELOADED_STATE__.footer = {
        props: {"unrelated": "footer block, appears after JobAdContent"}
      };
</script></body></html>`;
}

describe("extractJobAdProps", () => {
  test("picks the props value that follows JobAdContent, not an earlier or later one", () => {
    const html = detailPageFixture({ jobAdId: 14030156, marker: "this-one" });
    const props = extractJobAdProps(html);
    expect(props.marker).toBe("this-one");
  });

  test("returns null when JobAdContent is absent", () => {
    expect(extractJobAdProps("<html><body>no job ad here</body></html>")).toBeNull();
  });
});

describe("parseJobDetail", () => {
  test("parses title/company/location/date/contractType/workType/description from listingHeader + textSections", () => {
    const html = detailPageFixture({
      jobAdId: 14030156,
      jobAdTitle: "Field CTO Rubrik (m/w/d)",
      listingHeader: {
        listingData: {
          title: "Field CTO Rubrik (m/w/d)",
          metaData: {
            contractType: "Feste Anstellung",
            workType: "Homeoffice möglich, Vollzeit",
            location: "Frankfurt am Main, Berlin",
            onlineDate: "2026-07-18T22:04:32.003Z",
          },
          companyData: {
            name: "operational services GmbH & Co. KG",
            companyNameResultPageUrl: "https://www.stepstone.de/cmp/de/operational-services-72471/jobs.html",
          },
        },
      },
      textSections: [
        { title: "OS", content: "<p>Erste Zeile.</p>" },
        { title: "DER JOB", content: "<p>Zweite Zeile.</p><br>Dritte Zeile." },
      ],
    });
    const job = parseJobDetail(html, "14030156");
    expect(job.id).toBe("14030156");
    expect(job.title).toBe("Field CTO Rubrik (m/w/d)");
    expect(job.company).toBe("operational services GmbH & Co. KG");
    expect(job.companyUrl).toBe("https://www.stepstone.de/cmp/de/operational-services-72471/jobs.html");
    expect(job.location).toBe("Frankfurt am Main, Berlin");
    expect(job.date).toBe("2026-07-18");
    expect(job.contractType).toBe("Feste Anstellung");
    expect(job.workType).toBe("Homeoffice möglich, Vollzeit");
    expect(job.employmentType).toBe("Feste Anstellung");
    expect(job.deadline).toBeNull();
    expect(job.applyUrl).toBeNull();
    expect(job.description).toContain("OS");
    expect(job.description).toContain("Erste Zeile.");
    expect(job.description).toContain("DER JOB");
    expect(job.description).toContain("Zweite Zeile.");
    expect(job.description).toContain("Dritte Zeile.");
    expect(job.url).toBe("https://www.stepstone.de/stellenangebote--job--14030156-inline.html");
  });

  test("falls back to jobAdTitle/jobAdLocation when listingHeader is absent", () => {
    const html = detailPageFixture({
      jobAdTitle: "Fallback Title",
      jobAdLocation: "Remote",
    });
    const job = parseJobDetail(html, "999");
    expect(job.title).toBe("Fallback Title");
    expect(job.location).toBe("Remote");
  });

  test("falls back to (untitled) and null description when props is entirely missing", () => {
    const job = parseJobDetail("<html><body>no structured data here</body></html>", "999");
    expect(job.title).toBe("(untitled)");
    expect(job.description).toBeNull();
  });
});

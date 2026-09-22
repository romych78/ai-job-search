import { describe, test, expect } from "bun:test";
import {
  extractProviderData,
  extractDivContent,
  parseSearchResults,
  parseJobDetail,
} from "../src/helpers";

function searchPageFixture(results: unknown[]): string {
  const blob = {
    metaData: {
      mosaicProviderJobCardsModel: { results },
    },
  };
  // Embed a nested-brace HTML snippet inside a string field to exercise the
  // depth-tracking extractor — a naive regex would stop at the first "}" it
  // sees inside this snippet.
  return `<html><body><script>
window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(blob)};
window.mosaic.providerData["mosaic-provider-other"]={"unrelated": true};
</script></body></html>`;
}

describe("extractProviderData", () => {
  test("extracts a provider blob by key", () => {
    const html = searchPageFixture([]);
    const data = extractProviderData(html, "mosaic-provider-jobcards");
    expect(data.metaData.mosaicProviderJobCardsModel.results).toEqual([]);
  });

  test("does not truncate on nested braces inside quoted strings", () => {
    const html = `<script>window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(
      { metaData: { note: "a { b } c { d } e", mosaicProviderJobCardsModel: { results: [] } } },
    )};</script>`;
    const data = extractProviderData(html, "mosaic-provider-jobcards");
    expect(data.metaData.note).toBe("a { b } c { d } e");
  });

  test("returns null when the provider key is absent", () => {
    const html = "<script>window.mosaic.providerData[\"something-else\"]={};</script>";
    expect(extractProviderData(html, "mosaic-provider-jobcards")).toBeNull();
  });
});

describe("parseSearchResults", () => {
  test("maps jobkey/displayTitle/company/formattedLocation/pubDate/relativeTime", () => {
    const html = searchPageFixture([
      {
        jobkey: "48ee97925d1c9ac5",
        displayTitle: "AI Consultant (m/w/d)",
        company: "elunic AG",
        companyOverviewLink: "/cmp/Elunic-Gmbh-2",
        formattedLocation: "Deutschland",
        pubDate: 1780808400000,
        formattedRelativeTime: "vor 30+ Tagen",
      },
    ]);
    const { results } = parseSearchResults(html);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.id).toBe("48ee97925d1c9ac5");
    expect(r.title).toBe("AI Consultant (m/w/d)");
    expect(r.company).toBe("elunic AG");
    expect(r.companyUrl).toBe("https://de.indeed.com/cmp/Elunic-Gmbh-2");
    expect(r.location).toBe("Deutschland");
    expect(r.date).toBe("2026-06-07");
    expect(r.relativeDate).toBe("vor 30+ Tagen");
    expect(r.url).toBe("https://de.indeed.com/viewjob?jk=48ee97925d1c9ac5");
  });

  test("drops entries missing a jobkey or title", () => {
    const html = searchPageFixture([
      { jobkey: "", displayTitle: "No key" },
      { jobkey: "abc123", displayTitle: "" },
      { jobkey: "def456", displayTitle: "Valid Title" },
    ]);
    const { results } = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("def456");
  });

  test("nulls out missing optional fields rather than omitting them", () => {
    const html = searchPageFixture([{ jobkey: "abc123", displayTitle: "Bare Minimum" }]);
    const { results } = parseSearchResults(html);
    const r = results[0];
    expect(r.company).toBeNull();
    expect(r.companyUrl).toBeNull();
    expect(r.location).toBeNull();
    expect(r.date).toBeNull();
    expect(r.relativeDate).toBeNull();
  });

  test("throws a clear error when the jobcards blob is missing (e.g. a sign-in page)", () => {
    const html = "<html><body>Please sign in</body></html>";
    expect(() => parseSearchResults(html)).toThrow(/sign-in|markup/i);
  });
});

function detailPageFixture(ld: Record<string, unknown>): string {
  return `<html><body>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</body></html>`;
}

describe("parseJobDetail", () => {
  test("parses title/company/location/date/deadline/employmentType/description from JSON-LD", () => {
    const html = detailPageFixture({
      "@context": "http://schema.org",
      "@type": "JobPosting",
      title: "CTO / Co-Managing Director (m/w/d)",
      datePosted: "2026-03-09T17:11:24.164Z",
      validThrough: "2026-12-05T16:06:22.095Z",
      employmentType: ["FULL_TIME"],
      hiringOrganization: { "@type": "Organization", name: "HOCHTIEF Aktiengesellschaft" },
      jobLocation: {
        "@type": "Place",
        address: { "@type": "PostalAddress", addressCountry: "DE", addressLocality: "Essen", addressRegion: "NW" },
      },
      description: "<div><p>Als CTO &amp; Co-Managing Director...</p><br>Zweite Zeile</div>",
    });
    const job = parseJobDetail(html, "e23b34b70fd69712");
    expect(job.id).toBe("e23b34b70fd69712");
    expect(job.title).toBe("CTO / Co-Managing Director (m/w/d)");
    expect(job.company).toBe("HOCHTIEF Aktiengesellschaft");
    expect(job.location).toBe("Essen, NW, DE");
    expect(job.date).toBe("2026-03-09");
    expect(job.deadline).toBe("2026-12-05");
    expect(job.employmentType).toBe("FULL_TIME");
    expect(job.description).toContain("Als CTO & Co-Managing Director...");
    expect(job.description).toContain("Zweite Zeile");
    expect(job.url).toBe("https://de.indeed.com/viewjob?jk=e23b34b70fd69712");
  });

  test("falls back to #jobDescriptionText when the JSON-LD description is missing", () => {
    const html = `<html><body>
<script type="application/ld+json">${JSON.stringify({ title: "Fallback Job" })}</script>
<div id="jobDescriptionText" class="jobsearch-JobComponent-description">
  <div>Full text here <strong>bold</strong> and more.</div>
</div>
</body></html>`;
    const job = parseJobDetail(html, "abc123");
    expect(job.title).toBe("Fallback Job");
    expect(job.description).toContain("Full text here");
    expect(job.description).toContain("bold");
  });

  test("falls back to (untitled) when neither JSON-LD nor header title is present", () => {
    const html = "<html><body>no structured data here</body></html>";
    const job = parseJobDetail(html, "abc123");
    expect(job.title).toBe("(untitled)");
    expect(job.description).toBeNull();
  });

  // Regression: a sponsored/"gesponsert" listing (jk=48ee97925d1c9ac5, confirmed
  // live) renders with no JSON-LD block at all, but still carries company/location
  // as plain JSON-string literals inside its JS bundle.
  test("falls back to companyName/companyOverviewLink/formattedLocation literals when JSON-LD is entirely absent", () => {
    const html = `<html><body>
<div id="jobDescriptionText"><div>Some description text.</div></div>
<script>
(()=>{"use strict";var bundleNoise={"unrelated":{"a":1}};
var jobModel={"companyName":"elunic AG","companyOverviewLink":"https:\\u002F\\u002Fde.indeed.com\\u002Fcmp\\u002FElunic-Gmbh-2?campaignid=mobvjcmp\\u0026tk=abc","formattedLocation":"Deutschland"};
})();
</script>
</body></html>`;
    const job = parseJobDetail(html, "48ee97925d1c9ac5");
    expect(job.company).toBe("elunic AG");
    expect(job.companyUrl).toBe("https://de.indeed.com/cmp/Elunic-Gmbh-2");
    expect(job.location).toBe("Deutschland");
    // No structured date/deadline/employmentType source exists for this class of
    // listing — these should be null, not garbage from an unrelated match.
    expect(job.date).toBeNull();
    expect(job.deadline).toBeNull();
    expect(job.employmentType).toBeNull();
  });

  test("JSON-LD fields take priority over the JS-bundle-literal fallback when both are present", () => {
    const html = `<html><body>
<script type="application/ld+json">${JSON.stringify({
      title: "From LD",
      hiringOrganization: { name: "LD Company" },
      jobLocation: { address: { addressLocality: "LD City" } },
    })}</script>
<script>var x={"companyName":"Bundle Company","formattedLocation":"Bundle City"};</script>
</body></html>`;
    const job = parseJobDetail(html, "abc123");
    expect(job.company).toBe("LD Company");
    expect(job.location).toBe("LD City");
  });
});

describe("extractDivContent", () => {
  test("extracts by id, handling nested divs", () => {
    const html = `<div id="jobDescriptionText"><div>Requirements:</div><p>Body</p></div>`;
    expect(extractDivContent(html, "id", "jobDescriptionText")).toBe("<div>Requirements:</div><p>Body</p>");
  });

  test("returns null when the id is not found", () => {
    expect(extractDivContent("<div>no id</div>", "id", "jobDescriptionText")).toBeNull();
  });
});

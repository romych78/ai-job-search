import { afterEach, describe, test, expect } from "bun:test";
import {
  transliterate,
  slugifyLocation,
  buildListingUrl,
  isExternalListing,
  parseSearchResults,
  parseJobDetail,
  resolveCategory,
  resolveCategoryCode,
  type CategoryCode,
} from "../src/helpers";

describe("transliterate / slugifyLocation", () => {
  test("transliterates German umlauts and ß the way meinestadt's own slugs do", () => {
    expect(transliterate("München")).toBe("muenchen");
    expect(transliterate("Geschäftsführer")).toBe("geschaeftsfuehrer");
    expect(transliterate("Straße")).toBe("strasse");
  });

  test("defaults to nationwide when no location is given", () => {
    expect(slugifyLocation()).toBe("deutschland");
    expect(slugifyLocation("")).toBe("deutschland");
    expect(slugifyLocation("   ")).toBe("deutschland");
  });

  test("slugifies a real city name", () => {
    expect(slugifyLocation("Frankfurt am Main")).toBe("frankfurt-am-main");
  });
});

describe("buildListingUrl", () => {
  test("builds the city+category listing URL", () => {
    const cat: CategoryCode = { segment: "jkl", code: "0-15214-15780" };
    expect(buildListingUrl("münchen", cat)).toBe("https://jobs.meinestadt.de/muenchen/jkl/0-15214-15780");
    expect(buildListingUrl(undefined, cat)).toBe("https://jobs.meinestadt.de/deutschland/jkl/0-15214-15780");
  });
});

describe("isExternalListing", () => {
  test("flags the partner redirect wrapper", () => {
    expect(isExternalListing("https://www.meinestadt.de/berlin/redirect/jobs-redirect?redirectUrl=x&id=1")).toBe(true);
    expect(isExternalListing("https://jobs.meinestadt.de/berlin/premium?id=1")).toBe(false);
    expect(isExternalListing("https://jobs.meinestadt.de/berlin/standard?id=1")).toBe(false);
  });
});

function resultCardFixture(opts: {
  href: string;
  title: string;
  company?: string;
  location?: string;
  date?: string;
}): string {
  return `<li
    class="m-resultListEntryJobScan  -padded -polePosition -initial"
    data-component="resultListEntry-jobScan"
    data-position="1"
><div class="m-resultListEntryJobScan__section"><a class="a-clickArea m-resultListEntryJobScan__clickArea -showVisited   js-mstItem " href="${opts.href}" data-component="clickArea" title="${opts.title}"><h3
    id="headline-96"
    class="a-headline -h3 m-resultListEntryJobScan__headline"
    data-component="headline"
>
    ${opts.title}
</h3></a></div><div class="m-resultListEntryJobScan__section"><div class="m-resultListEntryJobScan__companyAndBadge"><div class="m-resultListEntryJobScan__company">
    ${opts.company ?? ""}
</div></div></div><div class="m-resultListEntryJobScan__section"><div class="m-resultListEntryJobScan__meta"><div class="m-resultListEntryJobScan__location"><i class="m-resultListEntryJobScan__icon fas fa-mapPinRounded"></i>
    ${opts.location ?? ""}
</div><div class="m-resultListEntryJobScan__date"><i class="m-resultListEntryJobScan__icon fas fa-clockRounded"></i>
    ${opts.date ?? ""}
</div></div></div></li>`;
}

describe("parseSearchResults", () => {
  test("parses id/title/company/location/date/url from a native premium card", () => {
    const card = resultCardFixture({
      href: "https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203",
      title: "Geschäftsführung (m/w/d)",
      company: "Förderung der Bewährungshilfe in Hessen e.V.",
      location: "Frankfurt am Main",
      date: "Aktualisiert",
    });
    const html = `<html><body><ul>${card}</ul>
      <script type="application/ld+json">{"name":"x","numberOfItems":133,"itemListElement":[],"@context":"http://schema.org","@type":"OfferCatalog"}</script>
    </body></html>`;
    const { total, results } = parseSearchResults(html);
    expect(total).toBe(133);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.id).toBe("100013968203");
    expect(r.title).toBe("Geschäftsführung (m/w/d)");
    expect(r.company).toBe("Förderung der Bewährungshilfe in Hessen e.V.");
    expect(r.location).toBe("Frankfurt am Main");
    expect(r.date).toBe("Aktualisiert");
    expect(r.url).toBe("https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203");
    expect(r.isExternal).toBe(false);
  });

  test("flags a partner redirect card as external and still extracts its id", () => {
    const card = resultCardFixture({
      href: "https://www.meinestadt.de/frankfurt-am-main/redirect/jobs-redirect?redirectUrl=abc&partner=def&id=100014611011",
      title: "Sales Manager (m/w/d)",
      company: "Some GmbH",
      location: "Frankfurt am Main",
      date: "03.09.2026",
    });
    const html = `<ul>${card}</ul>`;
    const { results } = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].isExternal).toBe(true);
    expect(results[0].id).toBe("100014611011");
  });

  test("falls back to hitAmount when no ld+json numberOfItems is present", () => {
    const card = resultCardFixture({
      href: "https://jobs.meinestadt.de/berlin/standard?id=1",
      title: "Test Job",
    });
    const html = `<span id="a-hitAmount--1" class="o-resultlist__hitAmount a-hitAmount"><span class="a-hitAmount__number">129</span> Treffer</span><ul>${card}</ul>`;
    const { total } = parseSearchResults(html);
    expect(total).toBe(129);
  });

  test("drops cards with no title", () => {
    const card = resultCardFixture({ href: "https://jobs.meinestadt.de/berlin/standard?id=1", title: "" });
    const { results } = parseSearchResults(`<ul>${card}</ul>`);
    expect(results).toHaveLength(0);
  });

  test("returns zero results and zero total for an empty resultlist", () => {
    const { total, results } = parseSearchResults("<html><body>no jobs here</body></html>");
    expect(total).toBe(0);
    expect(results).toEqual([]);
  });
});

function premiumDetailFixture(jobPosting: Record<string, unknown>): string {
  return `<html><body><script type="application/ld+json">
${JSON.stringify(jobPosting)}
</script></body></html>`;
}

describe("parseJobDetail — premium (JobPosting ld+json)", () => {
  test("parses title/company/location/date/deadline/employmentType/description", () => {
    const html = premiumDetailFixture({
      "@context": "http://schema.org",
      "@type": "JobPosting",
      title: "Geschäftsführung (m/w/d)",
      description: "<ul>\n <li>Erste Aufgabe</li>\n <li>Zweite Aufgabe</li>\n</ul>\n<p>Profil</p>",
      hiringOrganization: "Förderung der Bewährungshilfe in Hessen e.V.",
      datePosted: "2026-09-04",
      validThrough: "2026-09-29",
      employmentType: "Vollzeit oder Teilzeit",
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Frankfurt am Main" } },
    });
    const job = parseJobDetail(html, "100013968203", "https://jobs.meinestadt.de/frankfurt-am-main/premium?id=100013968203");
    expect(job.title).toBe("Geschäftsführung (m/w/d)");
    expect(job.company).toBe("Förderung der Bewährungshilfe in Hessen e.V.");
    expect(job.location).toBe("Frankfurt am Main");
    expect(job.date).toBe("2026-09-04");
    expect(job.deadline).toBe("2026-09-29");
    expect(job.employmentType).toBe("Vollzeit oder Teilzeit");
    expect(job.description).toContain("Erste Aufgabe");
    expect(job.description).toContain("Zweite Aufgabe");
    expect(job.description).toContain("Profil");
    expect(job.applyUrl).toBeNull();
    expect(job.isExternal).toBe(false);
  });
});

function standardDetailFixture(opts: {
  title: string;
  company: string;
  location: string;
  description: string;
  startDate: string;
}): string {
  return `<html><body>
<h1 id="headline-34" class="a-headline -h1" data-component="headline" data-mod="h1">
    ${opts.title}
</h1>
<div class="ms-jobDetailHeader__companyDetails"><span class="ms-jobDetailHeader__companyName">
    ${opts.company}
</span></div>
<div class="m-croppedList__content"><ul class="m-croppedList__content"><li class="m-croppedList__item">${opts.location}</li></ul></div>
<button data-mst="{&quot;mslayer_element_detail_start_date&quot;:&quot;not_set&quot;}"></button>
<article class="ms-jobDetailStyledText js-mstWrapper" data-component="jobDetailStyledText">${opts.description}</article>
<button data-mst="{&quot;mslayer_element_detail_start_date&quot;:&quot;${opts.startDate}&quot;}"></button>
</body></html>`;
}

describe("parseJobDetail — standard (HTML fallback, no ld+json JobPosting)", () => {
  test("parses title/company/location/description/date from markup, leaves employmentType/deadline null", () => {
    const html = standardDetailFixture({
      title: "Stellv. Geschäftsführung (m/w/d)",
      company: "AHF - AIDS-Hilfe Frankfurt e.V.",
      location: "Frankfurt am Main",
      description: "<p>Erste Zeile.</p><br>Zweite Zeile.",
      startDate: "20260902",
    });
    const job = parseJobDetail(html, "260203056", "https://jobs.meinestadt.de/frankfurt-am-main/standard?id=260203056");
    expect(job.title).toBe("Stellv. Geschäftsführung (m/w/d)");
    expect(job.company).toBe("AHF - AIDS-Hilfe Frankfurt e.V.");
    expect(job.location).toBe("Frankfurt am Main");
    expect(job.date).toBe("2026-09-02");
    expect(job.description).toContain("Erste Zeile.");
    expect(job.description).toContain("Zweite Zeile.");
    expect(job.employmentType).toBeNull();
    expect(job.deadline).toBeNull();
    expect(job.applyUrl).toBeNull();
  });

  test("falls back to (untitled) when even the h1 is missing", () => {
    const job = parseJobDetail("<html><body>nothing here</body></html>", "1", "https://jobs.meinestadt.de/berlin/standard?id=1");
    expect(job.title).toBe("(untitled)");
    expect(job.description).toBeNull();
  });
});

describe("resolveCategory / resolveCategoryCode (offline, stubbed fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetchOnce(body: string) {
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  }

  test("matches a German category by word-substring against the sitemap index", async () => {
    stubFetchOnce(`<?xml version="1.0"?><urlset>
      <url><loc>https://jobs.meinestadt.de/sitemaps/jk/jobs-geschaeftsfuehrer-vorstand-stadt.xml</loc></url>
      <url><loc>https://jobs.meinestadt.de/sitemaps/jk/jobs-it-manager-it-projektleiter-stadt.xml</loc></url>
    </urlset>`);
    const match = await resolveCategory("Geschäftsführer");
    expect(match?.slug).toBe("geschaeftsfuehrer-vorstand");
  });

  test("returns null when no category matches (e.g. an English abbreviation)", async () => {
    stubFetchOnce(`<?xml version="1.0"?><urlset>
      <url><loc>https://jobs.meinestadt.de/sitemaps/jk/jobs-geschaeftsfuehrer-vorstand-stadt.xml</loc></url>
    </urlset>`);
    const match = await resolveCategory("CTO");
    expect(match).toBeNull();
  });

  test("extracts the city-independent jkl/jk code from a category sitemap", async () => {
    stubFetchOnce(`<?xml version="1.0"?><urlset>
      <url><loc>https://jobs.meinestadt.de/berlin/jkl/0-15214-15780</loc></url>
      <url><loc>https://jobs.meinestadt.de/hamburg/jkl/0-15214-15780</loc></url>
    </urlset>`);
    const code = await resolveCategoryCode("https://jobs.meinestadt.de/sitemaps/jk/jobs-geschaeftsfuehrer-vorstand-stadt.xml");
    expect(code).toEqual({ segment: "jkl", code: "0-15214-15780" });
  });
});

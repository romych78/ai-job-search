# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (default + German-market CLIs):
- **linkedin.com/jobs** - LinkedIn job listings (filter: Germany / remote); covered by `linkedin-search` CLI
- **freehire-search** - country-agnostic CLI, covers general listings
- **stepstone.de** - Germany's largest general job board; covered by `stepstone-search` CLI (page 1 only, no age filter - see its SKILL.md)
- **de.indeed.com** - covered by `indeed-de-search` CLI (search only; `detail` sits outside Indeed's robots.txt allowance for a generic bot - personal use only, see its SKILL.md)
- **xing.com** - DACH-region professional network; covered by `xing-search` CLI (its job-search path sits outside Xing's robots.txt allowance for a generic bot - personal use only, see its SKILL.md)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters; no specific target companies tracked - casting a wide net rather than monitoring named employers
- Fallback `site:` filters for the three German-market portals, in case a CLI is temporarily unavailable:
  - `site:stepstone.de "<role>"`
  - `site:de.indeed.com "<role>"`
  - `site:xing.com/jobs "<role>"`

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: CTO / VP Engineering / VP Technology

These match Roman's strongest and most desired career direction - sole or top-level technical executive roles.

```
site:linkedin.com/jobs "CTO" remote Germany
site:linkedin.com/jobs "VP Engineering" remote Germany
site:linkedin.com/jobs "VP Technology" remote Germany
"Chief Technology Officer" remote Germany -site:linkedin.com
```

### Priority 2: Director of Engineering / Director of R&D

Senior leadership within a larger engineering org - Roman's newer stated direction (matches his current Similarweb role).

```
site:linkedin.com/jobs "Director of Engineering" remote Germany
site:linkedin.com/jobs "Director of R&D" remote Germany OR "R&D Director" remote Germany
"Head of Engineering" remote Germany -site:linkedin.com
```

### Priority 3: Domain-adjacent leadership roles

Adjacent domains where his background transfers directly.

```
"VP Engineering" "data platform" remote Germany
"CTO" "e-commerce" remote Germany
"Engineering Director" "analytics platform" remote Germany
```

### Priority 4: Broader technical leadership

Wider net for general senior technical leadership roles, in case title conventions differ.

```
site:linkedin.com/jobs "Engineering Manager" Kubernetes remote Germany
"Principal Engineer" OR "Chief Architect" remote Germany -site:linkedin.com
```

## Location Filter

Home base: Türkheim, Bavaria (86842). Remote-first search; a hybrid role is only acceptable if the office sits within roughly 50km of Türkheim - Munich is a named exception (see below) despite being further. Define acceptable areas:
- Fully remote (Germany, EU, or global) - ideal
- Hybrid with office in Augsburg, Memmingen, or Mindelheim (all within ~50km of Türkheim) - acceptable
- Hybrid with office in Munich - acceptable as a last resort despite exceeding 50km (~85km) - explicitly named exception, not a blanket "Munich area" allowance
- Hybrid with office anywhere else, or any role requiring relocation - too far (deal-breaker, see CLAUDE.md) - do not present these as medium/high fit even if skills match well
- When a posting's remote/hybrid policy is unclear from the listing, flag it rather than assuming either way

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries

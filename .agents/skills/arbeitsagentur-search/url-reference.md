# Bundesagentur für Arbeit Jobsuche API Reference

Public JSON API backing the official **jobboerse.arbeitsagentur.de** web app and its
mobile app. This skill uses the JSON API directly — no HTML scraping. Documented by
the community `bundesAPI` project ([GitHub](https://github.com/bundesAPI/jobsuche-api),
[OpenAPI browser](https://jobsuche.api.bund.dev/)); confirmed live 2026-09-04.

## Access notes (read before changing anything here)

- **No login/account required.** Search and job-detail description text are served
  the same way to anonymous browsers as to logged-in users.
- **Auth header is a public constant, not a personal credential**: `X-API-Key:
  jobboerse-jobsuche`. This exact clientId is hardcoded in BA's own official frontend
  JavaScript (visible via browser devtools on jobboerse.arbeitsagentur.de) and
  published in BA's own OpenAPI spec. It is not user-specific, not secret, and not
  rate-limited per caller identity as far as could be determined — hardcoded as a
  constant in `helpers.ts`, per the portal-skill contract's distinction between a
  shared public constant and a personal API key (the latter would need an env var).
- **robots.txt**: `jobboerse.arbeitsagentur.de/robots.txt` doesn't exist (404,
  confirmed live). `www.arbeitsagentur.de/robots.txt` is fully permissive
  (`Disallow:` empty, `Allow: /`). Neither blocks anything relevant — moot anyway
  since this skill talks to the JSON API host (`rest.arbeitsagentur.de`), not the
  HTML frontend.
- **BA's own stated position on automated use** (per a 2021 FragDenStaat FOI
  response, see `https://fragdenstaat.de/en/request/kosten-fur-die-anderung-der-schnittstelle/`):
  the interface "is not designed for mass evaluation using technical means," and BA
  added an anti-automation/CAPTCHA layer in 2021 specifically to stop **crawling for
  employer contact details**. This skill never requests employer contact data (no
  phone/email endpoint is used) and in live testing hit zero CAPTCHA challenges for
  search or job-description reads. Treat this the same as the repo's other
  ToS-adjacent portals (LinkedIn, Xing, Indeed DE): **personal use only, keep volume
  low** — see the warning in `SKILL.md`.
- **TLS note for anyone debugging from behind a corporate proxy**: if you're on a
  network with TLS inspection (e.g. Cato Networks, Zscaler), the certificate chain
  for `rest.arbeitsagentur.de` may be re-signed by your proxy. This is normal and
  unrelated to the API itself.

## Search

```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs
Header: X-API-Key: jobboerse-jobsuche
```

`/pc/v4/jobs` (the version number the API's own detail-endpoint path uses) returned
403 in live testing — only `/pc/v6/jobs` (and `/pc/v4/app/jobs`, untested here) work
for search. Do not "fix" the search path back to v4/jobs without re-testing live.

| Param | Meaning | Example | Notes |
|-------|---------|---------|-------|
| `was` | Freitext job-title/keyword search | `CTO`, `Softwareentwickler` | CLI: `--query`/`-q` |
| `wo` | Freitext location | `Berlin`, `München`, `Bayern` | CLI: `--location`/`-l` |
| `veroeffentlichtseit` | Days since posted, **0-100 only** (API-documented cap) | `30` | CLI: `--jobage`; values >100 rejected client-side with `BAD_ARG` |
| `page` | 1-indexed result page | `1` | CLI: `--page`; confirmed live that page 1 vs 2 return disjoint result sets |
| `size` | Results per page | `25` | CLI derives this from `--limit` (capped at 100 request-side; no documented hard cap was found, but this skill self-limits — see personal-use note above) |
| `angebotsart` | Offer type: `1`=ARBEIT, `2`=SELBSTAENDIGKEIT, `4`=AUSBILDUNG/duales Studium, `34`=Praktikum/Trainee | `1` | Not exposed as a CLI flag — left unset for the broadest coverage per this skill's design goal |
| `umkreis` | Radius in km around `wo` | `25` | Not exposed as a CLI flag (contract only requires query/location/jobage/page/limit/format) |

### Response shape

```json
{
  "ergebnisliste": [ { "referenznummer": "...", "stellenangebotsTitel": "...", "firma": "...",
                       "stellenlokationen": [{ "adresse": { "ort": "...", "region": "...", "land": "..." } }],
                       "datumErsteVeroeffentlichung": "YYYY-MM-DD", "externeURL": "..." /* only for externally-sourced postings */ } ],
  "maxErgebnisse": 86,
  "page": 1,
  "size": 25,
  "facetten": { ... }
}
```

- **`id`** is `referenznummer` — format varies wildly by source system
  (`10001-1003644689-S`, `11858-SDE-115995-STA-S`, `17159-k59015.1714-S`,
  `20063-2026seb82hrb-000-S` seen live) — treat it as an opaque string, never
  pattern-match its shape.
- **`location`** is built from `stellenlokationen[0].adresse` (`ort`, `region`,
  `land`) — the search results include a small number of cross-border postings
  (Austria via AMS, seen live for a plain `was=Softwareentwickler` query with no
  `wo` filter) surfaced through BA's EURES integration; `land` values like
  `OESTERREICH` are only naively title-cased (`Oesterreich`), not umlaut-restored.
- **`url`**: uses `externeURL` when the API supplies one (externally-sourced
  postings); otherwise built as `https://www.arbeitsagentur.de/jobsuche/jobdetail/<referenznummer>`
  (confirmed live — this is the real public detail-page URL for BA-native postings).
- No result carries employer phone/email — that sits behind BA's CAPTCHA-gated
  "Bewerbung" flow, which this skill does not touch.

## Detail

```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/{base64(referenznummer)}
Header: X-API-Key: jobboerse-jobsuche
```

`referenznummer` is base64-encoded (standard, not URL-safe alphabet — plain
`Buffer.from(refnr).toString("base64")` matches the API, confirmed live) and used as
a path segment. `/pc/v6/jobdetails/...` returned 403 live — only `/pc/v4/jobdetails/...`
works for detail (mixing API versions between search and detail is intentional, not a bug).

A non-existent/expired `referenznummer` returns **HTTP 404** with a JSON body
`{"messages":[{"code":"STELLENANGEBOT_NICHT_GEFUNDEN"}]}` — the CLI treats this as
`null` and surfaces `NOT_FOUND`.

### Description text (`stellenangebotsBeschreibung`)

- Already plain text, not HTML — no tags, no HTML entities were observed in live
  samples, so tag-stripping/entity-decoding in `cleanDescription()` is a defensive
  no-op for the common case, not the primary cleanup step.
- **Formatting is inconsistent across postings** because it depends on how each
  employer/agency submitted the listing: some come through with real Markdown-ish
  structure (`## Ihre Aufgaben`, blank-line paragraph breaks); others come through
  **hard-wrapped at ~65-70 characters with a single `\n`** and no paragraph breaks
  at all (section labels like "Das bringen Sie mit:" appear inline mid-paragraph,
  not on their own line). This skill does not attempt to re-flow or guess paragraph
  boundaries the source doesn't provide — it normalizes non-breaking spaces
  (` `) and collapses 3+ blank lines, nothing more. Don't "fix" hard-wrapped
  text by collapsing all single newlines — that would also destroy real single-line
  bullet lists in the other formatting style.
- Other detail fields used: `homeofficemoeglich` (bool), `arbeitszeitVollzeit` (bool),
  `vertragsdauer` (e.g. `UNBEFRISTET`/`BEFRISTET`), `gehaltsspanneVon`/`gehaltsspanneBis`
  (annual salary range in EUR, frequently absent — `verguetungsangabe` is often
  `KEINE_ANGABEN`).

## Live test results (2026-09-04)

| Query | `maxErgebnisse` |
|-------|-----------------|
| `Softwareentwickler` (sanity check, no location) | 241+ |
| `CTO` | 86 |
| `Geschäftsführer` | 804 |
| `Leiter Entwicklung` | 2188 |
| `Director` | 558 |

Executive-level German titles return plenty of results on this board — no need to
fall back from `CTO` to the alternate terms for this market, though they all work.

# fdarecords — Build Report (Batch 23)

Rebuild of the `openfda-mcp` MCP server (PyPI v0.1.0;
registry record `com.blackswancausallabs/openfda-mcp`)
from the firsthand spec in `specs-batch23/fdarecords.md`.
Built 2026-10-27.

## Identity

- npm: `@reneturcios/fdarecords` @ 0.1.0, bin `fdarecords` →
  `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/fdarecords`
  (matches `package.json` `mcpName`, `server.json` `name`,
  and the Dockerfile `io.modelcontextprotocol.server.name`
  label)
- server.json description (96 chars, verified):
  "openFDA identifier resolution: drug labels and
  applications, device submissions, classification."
  Note: the task brief carried a different description
  string ("openFDA device and drug data: 510(k), PMA and
  classification lookups, RWE signal screening, stats.")
  labelled 96 chars; measured, that string is 98 chars.
  The spec — marked authoritative in the brief, with its
  own string measured at exactly 96 — was followed.
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/fdarecords:0.1.0`) carries **no**
  `version` field (verified).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/geodata/tsconfig.json, verified
with `cmp`), .gitignore, package-lock.json, README.md
(fresh prose), LICENSE (MIT, © 2026 Rene Turcios),
CHANGELOG.md (single 0.1.0 entry dated 2026-10-27),
src/index.ts, src/cli.ts, src/mcp.ts, src/types.ts,
src/fda.ts (core), test/fda.test.ts, and the four
workflows under .github/workflows/ (publish-container
adapted: IMAGE ghcr.io/cloudcorprecords/fdarecords, smoke
assertion on server name `fdarecords`). Plus this
BUILD-REPORT.md and the parity-out/ artifacts.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`,
  handlers for `ListToolsRequestSchema` /
  `CallToolRequestSchema` from `sdk/types.js`), explicit
  JSON-schema literals for all 7 tools (search_drug_label,
  lookup_drugsfda_application, resolve_drug_to_application,
  screen_for_rwe_signals, lookup_device_submission,
  classify_device_product_code,
  validate_device_application); no McpServer/zod
  registration. Tool descriptions, property types and
  `required` lists are the fixture's, exactly. (The task
  brief mentioned a `validate_pma_number` tool with an
  integer `submissions` property; no such tool exists in
  the spec — the spec's validator is
  `validate_device_application` with a single string
  `submission_number` — so the spec was followed.)
- `src/fda.ts`: `VERSION = "0.1.0"`. All upstream access
  goes through an injectable fetch (deps `fetchFn`, `env`,
  `apiKey`, `baseUrl`) with an injectable `sleep` for
  backoff. `OPENFDA_API_KEY` is optional and sent as the
  `api_key` query parameter when set; base URL defaults to
  `https://api.fda.gov`, overridable via
  `OPENFDA_BASE_URL`. Contract: no results (HTTP 404, or
  200 with an empty `results` list / a `meta.results.total`
  of 0) → the JSON text `null`; transient failure (fetch
  throw, 429, 5xx) retried up to 2 additional times with
  100 ms then 400 ms backoff, then `openfda transient
  failure: HTTP <status>` / `openfda transient failure:
  <message>`; any other 4xx → `openfda request error:
  HTTP <status>` with no retry. Single-record tools return
  the first result object as JSON; the two label tools
  return the upstream body verbatim. Validation (before
  any request): `<arg> must be a non-empty string`,
  `limit must be an integer between 1 and 100`.
  Routing (README-pinned): K and DEN numbers search
  `k_number` on `/device/510k.json`; P numbers search
  `pma_number` on `/device/pma.json`; H numbers make no
  request — `lookup_device_submission` returns `null` and
  `validate_device_application` returns the class-III
  regulatory-inference object.
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version` (prints `0.1.0`); unknown
  subcommand → usage on stderr, exit 2; runtime/validation
  failures exit 1 (all spot-checked against the built CLI,
  including the no-network H-number validation call).

## Endpoint provenance (pinned vs pattern-derived)

Pinned at open.fda.gov/apis/:

- `GET /drug/label.json` — `search_drug_label`,
  `screen_for_rwe_signals`

Pattern-derived (same documented pattern, labelled in
README.md and in the fixture `_source`):

- `GET /drug/drugsfda.json` —
  `lookup_drugsfda_application`,
  `resolve_drug_to_application`
- `GET /device/510k.json` — `lookup_device_submission`
  (K / DEN), `validate_device_application`
- `GET /device/pma.json` — `lookup_device_submission` (P)
- `GET /device/classification.json` —
  `classify_device_product_code`,
  `validate_device_application`

Labelled compositions (the README pins purpose, not
mechanics): the section-scoped label search format,
`resolve_drug_to_application`'s brand/generic merge into
a sorted distinct array, `screen_for_rwe_signals`' fixed
term set combined with OR, and
`validate_device_application`'s composed result shape
(including the HDE `device_class_source` sentence, our
rendering of the README's pinned reasoning).

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0.
- `npm test`: **40 tests, 40 pass, 0 fail** — fake fetch,
  injected env and injected sleep only, no live network.
  Covers every tool's wire URL (including the
  section-scoped `search:` label URL and the `=`-style
  field searches), the PMA 404→`null` path, 404→`null` on
  every tool, 200-empty and total-0 → `null`, the verbatim
  body returns, the `api_key` parameter present and
  absent, base-URL overrides, transient retry ×2 then
  success (HTTP and throwing fetch, backoff [100, 400]
  asserted), retry-then-isError for 429 and for a throwing
  fetch, non-retried 4xx errors, every validation message,
  DEN-in-510k routing, the H no-request paths, the
  validate derivations (inference object, composed chain,
  null submission, missing product code), the resolve
  merge, and the RWE screening composition.
- `node dist/cli.js --version`: prints `0.1.0`.
  Unknown subcommand exits 2 with usage; a validation
  failure exits 1; a non-JSON argument exits 2.
- Parity: `harness/parity.py` against
  `harness/fixtures/openfda-mcp-tools-original.json`
  → **PASS, parity 100.0, identical_tools 7 / total 7**
  (see `parity-out/parity.json`).
- Lockfile (Route 3, clean from birth): generated in a
  temp dir containing only `package.json` with
  `npm install --package-lock-only --ignore-scripts
  --offline`; verified it parses, `name` ==
  `@reneturcios/fdarecords`, **128 package entries**;
  copied in as `package-lock.json`, then
  `npm install --offline --ignore-scripts` in the build
  dir succeeded for node_modules.
- Version consistency: `package.json` 0.1.0 =
  `server.json` top-level 0.1.0 = npm entry 0.1.0 = OCI
  tag `:0.1.0` = core `VERSION` 0.1.0 = CHANGELOG heading
  `## 0.1.0 (2026-10-27)`.

## Gaps

- None in the build itself. As the spec states, live
  upstream behaviour is unproven: no live call was made
  (tests are fake-fetch only). The endpoint paths beyond
  `/drug/label.json` follow the documented pattern rather
  than a pinned worked example, the HDE
  `device_class_source` sentence is a rendering of the
  README's reasoning, and the screening term set plus the
  validate/resolve result shapes are labelled compositions
  whose mechanics the original's README does not pin.

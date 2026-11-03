# fdarecords

FDA records without the portal spelunking. fdarecords is a
small client for the openFDA API that covers the two lookup
jobs people actually repeat: finding drug information —
label text, the Drugs@FDA application behind a product, the
application numbers behind a name — and tracing a medical
device from its submission number to its regulatory class.

Seven tools do the work. Three of them lean on findings
from the original project worth knowing up front: De Novo
(DEN) numbers are filed inside the 510(k) endpoint's
`k_number` field, because openFDA has no De Novo endpoint
of its own; HDE (H) numbers are not in openFDA at all, so
an H lookup answers `null` without pretending otherwise;
and the validation chain still reports class III for an H
number, labelled as regulatory inference rather than data.

One tool is a research aid, not an oracle:
`screen_for_rwe_signals` sweeps drug labels for
real-world-evidence vocabulary and returns whatever it
finds. It is experimental and unvalidated — treat its hits
as candidates for a human to review, never as findings.

## Configuration

- `OPENFDA_API_KEY` (optional) — an openFDA API key. When
  set it travels as the `api_key` query parameter and buys
  higher rate limits. Nothing requires it; every tool works
  keyless.
- `OPENFDA_BASE_URL` (optional) — API base URL. Defaults
  to `https://api.fda.gov`.

## The result contract

Every tool follows the same rules, and they are worth
stating plainly because they decide what a "no" looks like:

- A query that matches nothing returns the JSON text
  `null`. That covers an HTTP 404 and a 200 whose result
  list is empty.
- A transient failure — a timeout, a connection error, a
  429, a 5xx — is retried twice with backoff. If it still
  fails, the tool raises `openfda transient failure: ...`.
  A transient failure is never reported as a miss, so a
  `null` always means "not there", never "couldn't ask".
- Any other rejected request (a different 4xx) raises
  `openfda request error: HTTP <status>` immediately.
- Bad arguments fail before any request:
  `<arg> must be a non-empty string`, or
  `limit must be an integer between 1 and 100`.

Single-record tools return the first matching record as
JSON. The two label tools return the upstream response
body exactly as it arrived.

## Tools

- `search_drug_label` — search SPL label text for a
  `query`. Pass a `section` (an SPL field name such as
  `indications_and_usage`) to confine the search to that
  section. Optional `limit`, default 10.
- `lookup_drugsfda_application` — the Drugs@FDA record for
  an `application_number` (NDA, BLA and ANDA numbers all
  work).
- `resolve_drug_to_application` — go from a brand or
  generic `name` to the application numbers filed under
  it, returned as a sorted JSON array of distinct strings.
- `screen_for_rwe_signals` — the experimental sweep
  described above. An optional `query` adds one more term
  to the fixed signal set; optional `limit`, default 10.
- `lookup_device_submission` — a device record for a
  `submission_number`. K and DEN numbers search the 510(k)
  endpoint; P numbers search the PMA endpoint; H numbers
  return `null` (not in openFDA); anything else is
  rejected as an unrecognized prefix.
- `classify_device_product_code` — the device class and
  medical specialty for a `product_code`.
- `validate_device_application` — the full chain in one
  call: from `submission_number` through its product code
  to `device_class`, `medical_specialty` and `device_name`,
  with a `device_class_source` saying where the class came
  from. H numbers short-circuit to the labelled inference
  result; a record with no product code comes back with
  `"device_class": null` merged in.

### Endpoint provenance

`GET /drug/label.json` is the path pinned on the openFDA
API index. The remaining paths follow the same documented
pattern for their endpoint families and are labelled as
pattern-derived rather than pinned:

- `GET /drug/drugsfda.json` — pattern-derived
- `GET /device/510k.json` — pattern-derived
- `GET /device/pma.json` — pattern-derived
- `GET /device/classification.json` — pattern-derived

Three behaviours are compositions built for this client,
and are labelled as such in the code: how
`resolve_drug_to_application` merges its brand-name and
generic-name queries, the signal term set
`screen_for_rwe_signals` searches for, and the shape
`validate_device_application` composes from its two
records.

## CLI

Each tool is a subcommand taking one JSON argument string:

```bash
npx @reneturcios/fdarecords search_drug_label '{"query":"aspirin"}'
npx @reneturcios/fdarecords search_drug_label '{"query":"chest pain","section":"indications_and_usage","limit":25}'
npx @reneturcios/fdarecords lookup_drugsfda_application '{"application_number":"NDA021457"}'
npx @reneturcios/fdarecords resolve_drug_to_application '{"name":"Tylenol"}'
npx @reneturcios/fdarecords screen_for_rwe_signals '{"query":"diabetes"}'
npx @reneturcios/fdarecords lookup_device_submission '{"submission_number":"K123456"}'
npx @reneturcios/fdarecords classify_device_product_code '{"product_code":"ABC"}'
npx @reneturcios/fdarecords validate_device_application '{"submission_number":"H123456"}'
npx @reneturcios/fdarecords --version
```

Output is the tool's result text (`null`, a record, an
array, or the upstream body). Exit codes: `0` on success,
`1` on a runtime error (including a validation or upstream
failure), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/fdarecords mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "fdarecords": {
      "command": "npx",
      "args": ["-y", "@reneturcios/fdarecords", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/fdarecords
docker run --rm ghcr.io/cloudcorprecords/fdarecords lookup_device_submission '{"submission_number":"DEN200001"}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch only, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios

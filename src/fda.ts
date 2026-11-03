/**
 * fdarecords core: seven tools over the openFDA API.
 *
 * Shared rules, as documented in the spec:
 * - No key is required. When `OPENFDA_API_KEY` is set it is
 *   sent as the `api_key` query parameter (higher rate
 *   limits); its absence is never an error.
 * - The base URL defaults to `https://api.fda.gov` and is
 *   overridable via env `OPENFDA_BASE_URL` (or the
 *   injectable deps in tests).
 * - Result/error contract: a query with no results (HTTP
 *   404, or HTTP 200 with an empty `results` list / a
 *   `meta.results.total` of 0) returns the JSON text
 *   `null`. A transient failure (fetch throw, HTTP 429,
 *   HTTP 5xx) is retried up to 2 additional times with
 *   backoff via the injectable sleep (100 ms, then
 *   400 ms), then fails with `openfda transient failure:
 *   HTTP <status>` (or `openfda transient failure:
 *   <message>` for a throwing fetch). Any other 4xx fails
 *   with `openfda request error: HTTP <status>`.
 * - Single-record tools return the first result object as
 *   JSON; `search_drug_label` and `screen_for_rwe_signals`
 *   return the full upstream body verbatim.
 * - Validation runs before any request, with the pinned
 *   strings: `<arg> must be a non-empty string` and
 *   `limit must be an integer between 1 and 100`.
 * - Upstream access goes through the injectable fetch in
 *   deps, so tests run against a fake fetch only.
 *
 * Wires: `GET /drug/label.json` is pinned at
 * open.fda.gov/apis/; `/drug/drugsfda.json`,
 * `/device/510k.json`, `/device/pma.json` and
 * `/device/classification.json` follow the same documented
 * pattern (labelled). Two empirical findings are pinned by
 * the original's README: De Novo (DEN) numbers live in the
 * `k_number` field of `/device/510k`, and HDE (H) numbers
 * are not in openFDA at all.
 */
import type {
  ClassifyDeviceProductCodeArgs,
  FdaDeps,
  FetchFn,
  FetchResponseLike,
  LookupDeviceSubmissionArgs,
  LookupDrugsfdaApplicationArgs,
  ResolveDrugToApplicationArgs,
  ScreenForRweSignalsArgs,
  SearchDrugLabelArgs,
  SleepFn,
  ValidateDeviceApplicationArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://api.fda.gov";

/** Fixed signal terms for the RWE screen (labelled composition). */
export const RWE_SIGNAL_TERMS = [
  "registry",
  "real-world",
  "observational",
  "cohort",
  "claims data",
] as const;

const BACKOFF_MS = [100, 400];

const HDE_CLASS_SOURCE =
  "regulatory inference: HDE is the pathway for devices that would otherwise require a PMA";

const CLASSIFICATION_SOURCE = "openFDA device classification";

function envOf(deps: FdaDeps): Record<string, string | undefined> {
  return deps.env ?? process.env;
}

function baseUrl(deps: FdaDeps): string {
  if (deps.baseUrl && deps.baseUrl.trim() !== "") {
    return deps.baseUrl.trim().replace(/\/+$/, "");
  }
  const raw = envOf(deps).OPENFDA_BASE_URL;
  const base = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

function apiKey(deps: FdaDeps): string | undefined {
  const key = deps.apiKey ?? envOf(deps).OPENFDA_API_KEY;
  return key && key.trim() !== "" ? key : undefined;
}

async function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<FetchResponseLike> {
  return fetch(url, init);
}

function fetchFn(deps: FdaDeps): FetchFn {
  return deps.fetchFn ?? defaultFetch;
}

const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function sleepFn(deps: FdaDeps): SleepFn {
  return deps.sleep ?? realSleep;
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function requireNonEmptyString(value: unknown, arg: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${arg} must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, arg: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonEmptyString(value, arg);
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* HTTP layer: one GET with the null / transient / rejected contract   */
/* ------------------------------------------------------------------ */

interface FdaBody {
  /** Raw response text (for verbatim returns). */
  text: string;
  /** Parsed JSON body, or undefined when it did not parse. */
  parsed: unknown;
}

function isEmptyBody(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const body = parsed as Record<string, unknown>;
  if (Array.isArray(body.results) && body.results.length === 0) return true;
  const meta = body.meta as Record<string, unknown> | undefined;
  const metaResults = meta?.results as Record<string, unknown> | undefined;
  return metaResults?.total === 0;
}

function resultsOf(body: FdaBody | null): Record<string, unknown>[] {
  if (body === null) return [];
  const parsed = body.parsed as Record<string, unknown> | undefined;
  if (!parsed || !Array.isArray(parsed.results)) return [];
  return parsed.results as Record<string, unknown>[];
}

/**
 * Run one GET against openFDA. Returns the body, or null
 * when the query has no results per the contract. Throws
 * on transient exhaustion and on rejected requests.
 */
async function getJson(
  deps: FdaDeps,
  path: string,
  params: URLSearchParams,
): Promise<FdaBody | null> {
  const key = apiKey(deps);
  if (key) params.set("api_key", key);
  const url = `${baseUrl(deps)}${path}?${params.toString()}`;
  const sleep = sleepFn(deps);
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    let res: FetchResponseLike;
    try {
      res = await fetchFn(deps)(url, { method: "GET" });
    } catch (err) {
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`openfda transient failure: ${message}`);
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new Error(`openfda transient failure: HTTP ${res.status}`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`openfda request error: HTTP ${res.status}`);
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (isEmptyBody(parsed)) return null;
    return { text, parsed };
  }
  // Unreachable: the loop always returns or throws.
  throw new Error("openfda transient failure: exhausted retries");
}

function searchParams(search: string, limit?: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("search", search);
  if (limit !== undefined) params.set("limit", String(limit));
  return params;
}

/** First result serialised, the body verbatim as a fallback, or "null". */
function firstResultText(body: FdaBody | null): string {
  if (body === null) return "null";
  const results = resultsOf(body);
  if (results.length > 0) return JSON.stringify(results[0]);
  return body.text;
}

/* ------------------------------------------------------------------ */
/* Drug / biologic tools                                               */
/* ------------------------------------------------------------------ */

/**
 * Search SPL label text, optionally scoped to a section.
 * Wire (pinned pattern): GET /drug/label.json?search=<search>&limit=<limit|10>.
 * With a section, the search becomes `<section>:"<query>"`
 * (labelled composition); otherwise the query is verbatim.
 */
export async function searchDrugLabel(
  args: SearchDrugLabelArgs,
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const query = requireNonEmptyString(a.query, "query");
  const section = optionalNonEmptyString(a.section, "section");
  const limit = optionalLimit(a.limit) ?? 10;
  const search = section ? `${section}:"${query}"` : query;
  const body = await getJson(deps, "/drug/label.json", searchParams(search, limit));
  return body === null ? "null" : body.text;
}

/**
 * Drugs@FDA record for an NDA/BLA/ANDA number.
 * Wire: GET /drug/drugsfda.json?search=application_number:"<n>".
 */
export async function lookupDrugsfdaApplication(
  args: LookupDrugsfdaApplicationArgs,
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const number = requireNonEmptyString(a.application_number, "application_number");
  const body = await getJson(
    deps,
    "/drug/drugsfda.json",
    searchParams(`application_number:"${number}"`),
  );
  return firstResultText(body);
}

/**
 * Brand or generic name to application number(s).
 * Behaviour (labelled composition): one query against
 * `products.brand_name` and one against
 * `products.generic_name`; the distinct application
 * numbers across both result sets, sorted. `null` when
 * both queries come back empty per the contract.
 */
export async function resolveDrugToApplication(
  args: ResolveDrugToApplicationArgs,
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const name = requireNonEmptyString(a.name, "name");
  const found = new Set<string>();
  for (const field of ["products.brand_name", "products.generic_name"]) {
    const body = await getJson(
      deps,
      "/drug/drugsfda.json",
      searchParams(`${field}:"${name}"`),
    );
    for (const record of resultsOf(body)) {
      const value = record.application_number;
      if (typeof value === "string" && value.length > 0) found.add(value);
    }
  }
  if (found.size === 0) return "null";
  return JSON.stringify([...found].sort());
}

/**
 * Experimental, unvalidated sweep of drug labels for
 * real-world-evidence signals. Behaviour (labelled local
 * composition): the fixed signal terms (plus `query` when
 * given), each quoted, combined with OR, searched against
 * /drug/label.json. The upstream body comes back verbatim;
 * hits are candidates for human review, not findings.
 */
export async function screenForRweSignals(
  args: ScreenForRweSignalsArgs = {},
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const query = optionalNonEmptyString(a.query, "query");
  const limit = optionalLimit(a.limit) ?? 10;
  const terms: string[] = [...RWE_SIGNAL_TERMS];
  if (query) terms.push(query);
  const search = terms.map((term) => `"${term}"`).join(" OR ");
  const body = await getJson(deps, "/drug/label.json", searchParams(search, limit));
  return body === null ? "null" : body.text;
}

/* ------------------------------------------------------------------ */
/* Device tools                                                        */
/* ------------------------------------------------------------------ */

function submissionRoute(
  number: string,
): { path: string; search: string } | "hde" {
  if (number.startsWith("H")) return "hde";
  if (number.startsWith("K") || number.startsWith("DEN")) {
    return { path: "/device/510k.json", search: `k_number:"${number}"` };
  }
  if (number.startsWith("P")) {
    return { path: "/device/pma.json", search: `pma_number:"${number}"` };
  }
  throw new Error("unrecognized submission number prefix");
}

/** Parsed device record for a submission number, or null. */
async function lookupDeviceRecord(
  number: string,
  deps: FdaDeps,
): Promise<Record<string, unknown> | null> {
  const route = submissionRoute(number);
  if (route === "hde") return null;
  const body = await getJson(deps, route.path, searchParams(route.search));
  const results = resultsOf(body);
  return results.length > 0 ? results[0] : null;
}

/** Parsed classification record for a product code, or null. */
async function lookupClassificationRecord(
  productCode: string,
  deps: FdaDeps,
): Promise<Record<string, unknown> | null> {
  const body = await getJson(
    deps,
    "/device/classification.json",
    searchParams(`product_code:"${productCode}"`),
  );
  const results = resultsOf(body);
  return results.length > 0 ? results[0] : null;
}

/**
 * K / DEN / P / H number to device record. Routing
 * (README-pinned): K and DEN numbers search `k_number` on
 * /device/510k.json (De Novo numbers live in that field);
 * P numbers search `pma_number` on /device/pma.json
 * (labelled pattern); H numbers make no request and
 * return `null` (HDE numbers are not in openFDA at all).
 */
export async function lookupDeviceSubmission(
  args: LookupDeviceSubmissionArgs,
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const number = requireNonEmptyString(a.submission_number, "submission_number");
  const record = await lookupDeviceRecord(number, deps);
  return record === null ? "null" : JSON.stringify(record);
}

/**
 * Product code to device class and medical specialty.
 * Wire: GET /device/classification.json?search=product_code:"<code>".
 */
export async function classifyDeviceProductCode(
  args: ClassifyDeviceProductCodeArgs,
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const code = requireNonEmptyString(a.product_code, "product_code");
  const record = await lookupClassificationRecord(code, deps);
  return record === null ? "null" : JSON.stringify(record);
}

/**
 * Full chain: submission number to device class, medical
 * specialty and category. For H numbers (README-pinned)
 * the class comes from regulatory inference with no
 * request. Otherwise the submission record's product code
 * is classified and the two records are composed
 * (labelled composition); a record without a product code
 * comes back with `"device_class": null` merged in.
 */
export async function validateDeviceApplication(
  args: ValidateDeviceApplicationArgs,
  deps: FdaDeps = {},
): Promise<string> {
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const number = requireNonEmptyString(a.submission_number, "submission_number");
  if (number.startsWith("H")) {
    return JSON.stringify({
      device_class: "III",
      device_class_source: HDE_CLASS_SOURCE,
      medical_specialty: null,
    });
  }
  const record = await lookupDeviceRecord(number, deps);
  if (record === null) return "null";
  const productCode = record.product_code;
  if (typeof productCode !== "string" || productCode.length === 0) {
    return JSON.stringify({ ...record, device_class: null });
  }
  const classification = await lookupClassificationRecord(productCode, deps);
  return JSON.stringify({
    submission_number: number,
    product_code: productCode,
    device_class: classification?.device_class ?? null,
    medical_specialty: classification?.medical_specialty ?? null,
    device_name: classification?.device_name ?? null,
    device_class_source: CLASSIFICATION_SOURCE,
  });
}

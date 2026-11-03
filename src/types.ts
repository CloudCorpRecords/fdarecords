/**
 * fdarecords types.
 *
 * Seven tools over the openFDA API. Single-record tools
 * answer with the first result object serialised as JSON
 * text; the two label tools answer with the upstream body
 * verbatim; a query with no results answers with the JSON
 * text "null". Failures are Errors carrying the pinned
 * error strings from the spec.
 */

export interface SearchDrugLabelArgs {
  query: string;
  section?: string;
  limit?: number;
}

export interface LookupDrugsfdaApplicationArgs {
  application_number: string;
}

export interface ResolveDrugToApplicationArgs {
  name: string;
}

export interface ScreenForRweSignalsArgs {
  query?: string;
  limit?: number;
}

export interface LookupDeviceSubmissionArgs {
  submission_number: string;
}

export interface ClassifyDeviceProductCodeArgs {
  product_code: string;
}

export interface ValidateDeviceApplicationArgs {
  submission_number: string;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Injectable sleep, so retry backoff is instant in tests. */
export type SleepFn = (ms: number) => Promise<void>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface FdaDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Backoff sleep between retries. Defaults to a real timer. */
  sleep?: SleepFn;
  /** Environment (OPENFDA_API_KEY / OPENFDA_BASE_URL). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** API key override. Defaults to env OPENFDA_API_KEY. */
  apiKey?: string;
  /** Base URL override. Defaults to env OPENFDA_BASE_URL or the pinned default. */
  baseUrl?: string;
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDeviceProductCode,
  lookupDeviceSubmission,
  lookupDrugsfdaApplication,
  resolveDrugToApplication,
  screenForRweSignals,
  searchDrugLabel,
  validateDeviceApplication,
} from "../src/fda.js";
import type { FetchFn, FdaDeps } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch, an injected
 * env and an injected sleep: no live network, no live call is
 * made or claimed.
 */

type Captured = { url: string };

function makeFetch(
  handler: (url: string, call: number) => { status?: number; body: unknown },
  captured: Captured[] = [],
): FetchFn {
  let calls = 0;
  return async (url) => {
    captured.push({ url });
    calls += 1;
    const r = handler(url, calls);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
}

const okFetch = (body: unknown = { ok: true }, captured: Captured[] = []) =>
  makeFetch(() => ({ body }), captured);

function bodyWith(results: unknown[]): unknown {
  return { meta: { results: { total: results.length } }, results };
}

function deps(fetchFn: FetchFn, sleeps: number[] = [], extra: Partial<FdaDeps> = {}): FdaDeps {
  return {
    fetchFn,
    env: {},
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...extra,
  };
}

async function expectError(promise: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.equal(err instanceof Error ? err.message : String(err), message);
    return true;
  });
}

const BASE = "https://api.fda.gov";

describe("search_drug_label", () => {
  it("searches the query verbatim with the default limit and returns the body verbatim", async () => {
    const captured: Captured[] = [];
    const body = bodyWith([{ id: "lbl-1" }]);
    const out = await searchDrugLabel({ query: "aspirin" }, deps(okFetch(body, captured)));
    assert.equal(out, JSON.stringify(body));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, `${BASE}/drug/label.json?search=aspirin&limit=10`);
  });

  it("scopes the search to a section as <section>:\"<query>\"", async () => {
    const captured: Captured[] = [];
    await searchDrugLabel(
      { query: "chest pain", section: "indications_and_usage" },
      deps(okFetch(bodyWith([{ id: "x" }]), captured)),
    );
    assert.equal(
      captured[0].url,
      `${BASE}/drug/label.json?search=indications_and_usage%3A%22chest+pain%22&limit=10`,
    );
  });

  it("sends an explicit limit", async () => {
    const captured: Captured[] = [];
    await searchDrugLabel({ query: "aspirin", limit: 25 }, deps(okFetch(bodyWith([]), captured)));
    assert.equal(captured[0].url, `${BASE}/drug/label.json?search=aspirin&limit=25`);
  });

  it("returns a non-canonical string body verbatim", async () => {
    const raw = '{ "meta" : { "results": {"total": 3} },  "results": [1, 2, 3] }';
    const out = await searchDrugLabel({ query: "x" }, deps(okFetch(raw)));
    assert.equal(out, raw);
  });

  it("rejects an empty query before any request", async () => {
    const captured: Captured[] = [];
    await expectError(
      searchDrugLabel({ query: "" }, deps(okFetch({}, captured))),
      "query must be a non-empty string",
    );
    assert.deepEqual(captured, []);
  });

  it("rejects limit 0 and limit 101 and a non-integer limit", async () => {
    await expectError(
      searchDrugLabel({ query: "x", limit: 0 }, deps(okFetch())),
      "limit must be an integer between 1 and 100",
    );
    await expectError(
      searchDrugLabel({ query: "x", limit: 101 }, deps(okFetch())),
      "limit must be an integer between 1 and 100",
    );
    await expectError(
      searchDrugLabel({ query: "x", limit: 2.5 }, deps(okFetch())),
      "limit must be an integer between 1 and 100",
    );
  });
});

describe("lookup_drugsfda_application", () => {
  it("searches application_number with the = search syntax and returns the first result", async () => {
    const captured: Captured[] = [];
    const record = { application_number: "NDA021457", sponsor_name: "ACME" };
    const out = await lookupDrugsfdaApplication(
      { application_number: "NDA021457" },
      deps(okFetch(bodyWith([record, { application_number: "OTHER" }]), captured)),
    );
    assert.equal(out, JSON.stringify(record));
    assert.equal(
      captured[0].url,
      `${BASE}/drug/drugsfda.json?search=application_number%3A%22NDA021457%22`,
    );
  });

  it("rejects a missing application_number", async () => {
    await expectError(
      lookupDrugsfdaApplication({} as never, deps(okFetch())),
      "application_number must be a non-empty string",
    );
  });
});

describe("resolve_drug_to_application (composition)", () => {
  it("queries brand and generic names and returns the distinct numbers sorted", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch((url) => {
      if (url.includes("brand_name")) {
        return {
          body: bodyWith([
            { application_number: "NDA222222" },
            { application_number: "NDA111111" },
          ]),
        };
      }
      return {
        body: bodyWith([
          { application_number: "NDA111111" },
          { application_number: "ANDA333333" },
        ]),
      };
    }, captured);
    const out = await resolveDrugToApplication({ name: "Tylenol" }, deps(fetchFn));
    assert.equal(out, '["ANDA333333","NDA111111","NDA222222"]');
    assert.equal(captured.length, 2);
    assert.equal(
      captured[0].url,
      `${BASE}/drug/drugsfda.json?search=products.brand_name%3A%22Tylenol%22`,
    );
    assert.equal(
      captured[1].url,
      `${BASE}/drug/drugsfda.json?search=products.generic_name%3A%22Tylenol%22`,
    );
  });

  it("returns null when both queries are empty", async () => {
    const fetchFn = makeFetch(() => ({ body: bodyWith([]) }));
    const out = await resolveDrugToApplication({ name: "Nope" }, deps(fetchFn));
    assert.equal(out, "null");
  });

  it("rejects an empty name", async () => {
    await expectError(
      resolveDrugToApplication({ name: "" }, deps(okFetch())),
      "name must be a non-empty string",
    );
  });
});

describe("screen_for_rwe_signals (composition)", () => {
  it("searches the fixed signal terms combined with OR and returns the body verbatim", async () => {
    const captured: Captured[] = [];
    const body = bodyWith([{ id: "hit" }]);
    const out = await screenForRweSignals({}, deps(okFetch(body, captured)));
    assert.equal(out, JSON.stringify(body));
    assert.equal(
      captured[0].url,
      `${BASE}/drug/label.json?search=%22registry%22+OR+%22real-world%22+OR+%22observational%22+OR+%22cohort%22+OR+%22claims+data%22&limit=10`,
    );
  });

  it("adds the extra query term and an explicit limit", async () => {
    const captured: Captured[] = [];
    await screenForRweSignals({ query: "diabetes", limit: 5 }, deps(okFetch(bodyWith([{ id: 1 }]), captured)));
    assert.equal(
      captured[0].url,
      `${BASE}/drug/label.json?search=%22registry%22+OR+%22real-world%22+OR+%22observational%22+OR+%22cohort%22+OR+%22claims+data%22+OR+%22diabetes%22&limit=5`,
    );
  });

  it("rejects a bad limit", async () => {
    await expectError(
      screenForRweSignals({ limit: 0 }, deps(okFetch())),
      "limit must be an integer between 1 and 100",
    );
  });
});

describe("lookup_device_submission routing", () => {
  it("routes a K number to /device/510k.json on k_number", async () => {
    const captured: Captured[] = [];
    const record = { k_number: "K123456", device_name: "Widget" };
    const out = await lookupDeviceSubmission(
      { submission_number: "K123456" },
      deps(okFetch(bodyWith([record]), captured)),
    );
    assert.equal(out, JSON.stringify(record));
    assert.equal(captured[0].url, `${BASE}/device/510k.json?search=k_number%3A%22K123456%22`);
  });

  it("routes a DEN number to /device/510k.json on k_number (De Novo lives there)", async () => {
    const captured: Captured[] = [];
    await lookupDeviceSubmission(
      { submission_number: "DEN200001" },
      deps(okFetch(bodyWith([{ k_number: "DEN200001" }]), captured)),
    );
    assert.equal(captured[0].url, `${BASE}/device/510k.json?search=k_number%3A%22DEN200001%22`);
  });

  it("routes a P number to /device/pma.json on pma_number", async () => {
    const captured: Captured[] = [];
    const record = { pma_number: "P123456" };
    const out = await lookupDeviceSubmission(
      { submission_number: "P123456" },
      deps(okFetch(bodyWith([record]), captured)),
    );
    assert.equal(out, JSON.stringify(record));
    assert.equal(captured[0].url, `${BASE}/device/pma.json?search=pma_number%3A%22P123456%22`);
  });

  it("makes no request for an H number and returns null (HDE is not in openFDA)", async () => {
    const captured: Captured[] = [];
    const out = await lookupDeviceSubmission(
      { submission_number: "H123456" },
      deps(okFetch({}, captured)),
    );
    assert.equal(out, "null");
    assert.deepEqual(captured, []);
  });

  it("rejects an unrecognized prefix before any request", async () => {
    const captured: Captured[] = [];
    await expectError(
      lookupDeviceSubmission({ submission_number: "X999" }, deps(okFetch({}, captured))),
      "unrecognized submission number prefix",
    );
    assert.deepEqual(captured, []);
  });

  it("returns null when the PMA lookup answers 404", async () => {
    const fetchFn = makeFetch(() => ({ status: 404, body: { error: "nf" } }));
    const out = await lookupDeviceSubmission({ submission_number: "P000000" }, deps(fetchFn));
    assert.equal(out, "null");
  });
});

describe("classify_device_product_code", () => {
  it("searches product_code on /device/classification.json and returns the first result", async () => {
    const captured: Captured[] = [];
    const record = { product_code: "ABC", device_class: "II", medical_specialty: "Cardiovascular" };
    const out = await classifyDeviceProductCode(
      { product_code: "ABC" },
      deps(okFetch(bodyWith([record]), captured)),
    );
    assert.equal(out, JSON.stringify(record));
    assert.equal(
      captured[0].url,
      `${BASE}/device/classification.json?search=product_code%3A%22ABC%22`,
    );
  });

  it("rejects an empty product_code", async () => {
    await expectError(
      classifyDeviceProductCode({ product_code: "" }, deps(okFetch())),
      "product_code must be a non-empty string",
    );
  });
});

describe("validate_device_application derivations", () => {
  it("returns the HDE inference object for an H number with no request", async () => {
    const captured: Captured[] = [];
    const out = await validateDeviceApplication(
      { submission_number: "H123456" },
      deps(okFetch({}, captured)),
    );
    assert.deepEqual(JSON.parse(out), {
      device_class: "III",
      device_class_source:
        "regulatory inference: HDE is the pathway for devices that would otherwise require a PMA",
      medical_specialty: null,
    });
    assert.deepEqual(captured, []);
  });

  it("composes submission and classification records for a K number", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch((url) => {
      if (url.includes("/device/510k.json")) {
        return { body: bodyWith([{ k_number: "K123456", product_code: "ABC" }]) };
      }
      return {
        body: bodyWith([
          { product_code: "ABC", device_class: "II", medical_specialty: "Cardiovascular", device_name: "Widget" },
        ]),
      };
    }, captured);
    const out = await validateDeviceApplication({ submission_number: "K123456" }, deps(fetchFn));
    assert.deepEqual(JSON.parse(out), {
      submission_number: "K123456",
      product_code: "ABC",
      device_class: "II",
      medical_specialty: "Cardiovascular",
      device_name: "Widget",
      device_class_source: "openFDA device classification",
    });
    assert.equal(captured.length, 2);
    assert.equal(
      captured[1].url,
      `${BASE}/device/classification.json?search=product_code%3A%22ABC%22`,
    );
  });

  it("returns null when the submission lookup finds nothing", async () => {
    const fetchFn = makeFetch(() => ({ status: 404, body: {} }));
    const out = await validateDeviceApplication({ submission_number: "K000000" }, deps(fetchFn));
    assert.equal(out, "null");
  });

  it("merges device_class null into a record without a product code", async () => {
    const record = { k_number: "K123456", device_name: "Gadget" };
    const fetchFn = makeFetch(() => ({ body: bodyWith([record]) }));
    const out = await validateDeviceApplication({ submission_number: "K123456" }, deps(fetchFn));
    assert.deepEqual(JSON.parse(out), { ...record, device_class: null });
  });

  it("propagates the unrecognized-prefix error", async () => {
    await expectError(
      validateDeviceApplication({ submission_number: "Q123" }, deps(okFetch())),
      "unrecognized submission number prefix",
    );
  });
});

describe("the null contract on every tool", () => {
  it("maps HTTP 404 to null on every tool", async () => {
    const notFound = makeFetch(() => ({ status: 404, body: { error: "nf" } }));
    assert.equal(await searchDrugLabel({ query: "x" }, deps(notFound)), "null");
    assert.equal(
      await lookupDrugsfdaApplication({ application_number: "NDA1" }, deps(notFound)),
      "null",
    );
    assert.equal(await resolveDrugToApplication({ name: "x" }, deps(notFound)), "null");
    assert.equal(await screenForRweSignals({}, deps(notFound)), "null");
    assert.equal(
      await lookupDeviceSubmission({ submission_number: "K1" }, deps(notFound)),
      "null",
    );
    assert.equal(
      await classifyDeviceProductCode({ product_code: "ABC" }, deps(notFound)),
      "null",
    );
    assert.equal(
      await validateDeviceApplication({ submission_number: "K1" }, deps(notFound)),
      "null",
    );
  });

  it("maps HTTP 200 with an empty results list to null", async () => {
    const empty = okFetch(bodyWith([]));
    assert.equal(await lookupDrugsfdaApplication({ application_number: "NDA1" }, deps(empty)), "null");
    assert.equal(await searchDrugLabel({ query: "x" }, deps(empty)), "null");
  });

  it("maps HTTP 200 with meta.results.total 0 to null", async () => {
    const zero = okFetch({ meta: { results: { total: 0 } }, results: [{ a: 1 }] });
    assert.equal(await classifyDeviceProductCode({ product_code: "ABC" }, deps(zero)), "null");
  });
});

describe("transient retry and rejected requests", () => {
  it("retries a 500 twice with 100/400 ms backoff and then succeeds", async () => {
    const sleeps: number[] = [];
    const record = { application_number: "NDA021457" };
    const fetchFn = makeFetch((_url, call) =>
      call < 3 ? { status: 500, body: "boom" } : { body: bodyWith([record]) },
    );
    const out = await lookupDrugsfdaApplication(
      { application_number: "NDA021457" },
      deps(fetchFn, sleeps),
    );
    assert.equal(out, JSON.stringify(record));
    assert.deepEqual(sleeps, [100, 400]);
  });

  it("retries a throwing fetch and then succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls += 1;
      if (calls < 3) throw new Error("socket hang up");
      return { ok: true, status: 200, text: async () => JSON.stringify(bodyWith([{ pma_number: "P1" }])) };
    };
    const out = await lookupDeviceSubmission({ submission_number: "P1" }, deps(fetchFn, sleeps));
    assert.equal(out, '{"pma_number":"P1"}');
    assert.deepEqual(sleeps, [100, 400]);
  });

  it("fails with the transient HTTP error after the retries are exhausted (429)", async () => {
    const sleeps: number[] = [];
    const captured: Captured[] = [];
    const fetchFn = makeFetch(() => ({ status: 429, body: "slow down" }), captured);
    await expectError(
      searchDrugLabel({ query: "x" }, deps(fetchFn, sleeps)),
      "openfda transient failure: HTTP 429",
    );
    assert.equal(captured.length, 3);
    assert.deepEqual(sleeps, [100, 400]);
  });

  it("fails with the transient message after a throwing fetch is exhausted", async () => {
    const sleeps: number[] = [];
    const throwing: FetchFn = async () => {
      throw new Error("connection reset");
    };
    await expectError(
      classifyDeviceProductCode({ product_code: "ABC" }, deps(throwing, sleeps)),
      "openfda transient failure: connection reset",
    );
    assert.deepEqual(sleeps, [100, 400]);
  });

  it("does not retry a rejected 4xx request", async () => {
    const sleeps: number[] = [];
    const captured: Captured[] = [];
    const fetchFn = makeFetch(() => ({ status: 400, body: "bad request" }), captured);
    await expectError(
      lookupDrugsfdaApplication({ application_number: "NDA1" }, deps(fetchFn, sleeps)),
      "openfda request error: HTTP 400",
    );
    assert.equal(captured.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("maps a 403 to the request error without retrying", async () => {
    const fetchFn = makeFetch(() => ({ status: 403, body: "forbidden" }));
    await expectError(
      searchDrugLabel({ query: "x" }, deps(fetchFn)),
      "openfda request error: HTTP 403",
    );
  });
});

describe("API key and base URL", () => {
  it("sends OPENFDA_API_KEY as the api_key query parameter when set", async () => {
    const captured: Captured[] = [];
    await searchDrugLabel(
      { query: "aspirin" },
      deps(okFetch(bodyWith([{ id: 1 }]), captured), [], { env: { OPENFDA_API_KEY: "test-key" } }),
    );
    assert.equal(captured[0].url, `${BASE}/drug/label.json?search=aspirin&limit=10&api_key=test-key`);
  });

  it("sends no api_key parameter when the key is unset", async () => {
    const captured: Captured[] = [];
    await classifyDeviceProductCode(
      { product_code: "ABC" },
      deps(okFetch(bodyWith([{ product_code: "ABC" }]), captured)),
    );
    assert.ok(!captured[0].url.includes("api_key"));
  });

  it("honours OPENFDA_BASE_URL from env", async () => {
    const captured: Captured[] = [];
    await lookupDeviceSubmission(
      { submission_number: "K123456" },
      deps(okFetch(bodyWith([{ k_number: "K123456" }]), captured), [], {
        env: { OPENFDA_BASE_URL: "https://fda.example.test/api/" },
      }),
    );
    assert.equal(
      captured[0].url,
      "https://fda.example.test/api/device/510k.json?search=k_number%3A%22K123456%22",
    );
  });

  it("honours an injected baseUrl override", async () => {
    const captured: Captured[] = [];
    await lookupDrugsfdaApplication(
      { application_number: "NDA1" },
      deps(okFetch(bodyWith([{ application_number: "NDA1" }]), captured), [], {
        baseUrl: "https://mirror.example.test",
      }),
    );
    assert.equal(
      captured[0].url,
      "https://mirror.example.test/drug/drugsfda.json?search=application_number%3A%22NDA1%22",
    );
  });
});

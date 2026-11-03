# Changelog

## 0.1.0 (2026-10-27)

- Initial release: seven MCP tools and matching CLI subcommands
  over the openFDA API — `search_drug_label`,
  `lookup_drugsfda_application`, `resolve_drug_to_application`,
  `screen_for_rwe_signals`, `lookup_device_submission`,
  `classify_device_product_code`, and
  `validate_device_application`.
- No key is required; when `OPENFDA_API_KEY` is set it is sent
  as the `api_key` query parameter for higher rate limits
  (base URL via `OPENFDA_BASE_URL`).
- Result contract: a query with no results returns `null`;
  transient failures (timeout, connection error, 429, 5xx)
  are retried with backoff and then raise an error, never a
  cached miss; other rejected requests raise an error.

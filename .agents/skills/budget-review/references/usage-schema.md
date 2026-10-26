# Local usage event contract

`python3 scripts/usage_budget.py record --project-root <project>` reads one JSON object from stdin. It stores validated events in the project's private `.agent-usage.jsonl`; it never reads credentials or contacts a provider. Installed packages use `.agents/scripts/usage_budget.py`. Use a stable, unique `event_id` per provider call. Repeating an identical event is harmless; reusing an ID with different usage fails.

Required fields are `event_id`, `provider`, and `model`. Optional identifiers are `session_id` and `prompt_id`; the latter should match an entry in `prompt-log.md`. Identifiers are at most 200 characters and use letters, numbers, periods, underscores, colons, slashes, at signs, plus signs, or hyphens. The first character must be alphanumeric. Do not put prompts, completions, keys, or private prose in identifiers. Unknown fields are rejected.

`input_tokens`, `output_tokens`, `cached_input_tokens`, and `cache_write_input_tokens` are nonnegative integer measurements or `null`. `input_tokens` is the total input; cache reads (`cached_input_tokens`) and cache writes (`cache_write_input_tokens`) are known subsets of it, and together cannot exceed it. Supply `cached_input_tokens: 0` only when zero is known. Leave `cache_write_input_tokens` null when the provider does not bill cache writes separately. Output should use the provider's output total, including reasoning where that provider already includes it; no separate reasoning field is added.

Anthropic reports `input_tokens` as only the tokens after the last cache breakpoint. Send its usage object unchanged as `"anthropic_usage": {...}` instead of the token fields, and `record` maps it: total input is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, cache reads become `cached_input_tokens`, and cache creation becomes `cache_write_input_tokens`.

Rates are optional nonnegative decimal USD amounts per million tokens: `input_rate_per_million_usd`, `output_rate_per_million_usd`, `cached_input_rate_per_million_usd`, and `cache_write_rate_per_million_usd`. Prefer decimal strings; JSON numbers are read exactly, without float rounding. `provider_cost_usd` is an optional authoritative cost reported for this exact event. `pricing_source` and `pricing_date` record where supplied rates came from; the date uses `YYYY-MM-DD`. No rates are built in, and metadata is not proof that a rate remains current.

With known counts, calculated cost is `(uncached_input * input_rate + cached_input * cached_rate + cache_write * cache_write_rate + output * output_rate) / 1000000`, where uncached input is total input minus cache reads and writes. Zero-token components need no rate. Unknown cache counts prevent a calculation unless cached and uncached input rates are equal. Missing measurement or a necessary rate leaves calculated cost unknown. When both a provider cost and a calculation exist, the report shows both separately but selects the provider cost once for the known subtotal.

Example with synthetic measurements and caller-supplied rates:

```json
{"event_id":"example-call-1","provider":"example","model":"example-model","prompt_id":"prompt-1","input_tokens":1000,"cached_input_tokens":200,"output_tokens":100,"input_rate_per_million_usd":"2","cached_input_rate_per_million_usd":"0.5","output_rate_per_million_usd":"8","pricing_source":"Synthetic fixture; not real provider pricing","pricing_date":"2026-10-03"}
```

A rejected event prints `{"status":"error","code":"<reason>"}` with a fixed reason such as `invalid_event_fields` or `cached_tokens_must_be_known_subset`; codes never echo input values.

`report --project-root <project> --format json` returns model groups, known token subtotals, complete totals only when all recorded events are measured, cost coverage, and bounded prompt review cues. `--format markdown` renders the same review for reading. Even complete coverage of the ledger covers recorded calls only; it does not prove all providers or sessions were captured. Provider-reported and rate-calculated subtotals may overlap and must never be added together.

Optionally add `--budget-usd <amount>` to compare known recorded costs with a user-supplied budget. This does not enforce or change a budget. Remaining funds are unknown when any recorded event is unpriced or no usage exists. With fully priced records, a remaining amount is only a comparison against those records; unrecorded spending remains unknown. A negative amount indicates recorded spending exceeds the comparison budget.

The prompt review reads at most 5 MiB and analyzes the last 200 recognized sanitized entries. It returns IDs and heuristic flags, not prompt content. The ledger accepts at most 20,000 events or 8 MiB. Writes are serialized and atomically replaced. Locking has POSIX and Windows implementations; report host-specific verification limits honestly.

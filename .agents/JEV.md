# Optional Jev skill suggestions

Jev can suggest a skill from this package before an agent starts a task. The coding agent still reads the skill, checks its relevance, and performs the work. The integration uses Python 3.9 or newer, JSON input/output, and the standard library. It does not depend on the model powering the coding agent.

Jev is disabled by default. Local verification hooks keep working without an account, API key, or network connection. A first live routing comparison matched 30/32 proposed labels versus 32/32 for one blind coding-agent baseline. A later trial matched 24/24 context/test/browser labels, as did a blind coding agent. After the catalog cleanup, the hook's request format matched 29/29 in-scope routing labels. These small samples do not establish improved finished work; see [the measured trials](USAGE.md#first-measured-jev-trial).

<!-- reference-contents:start -->
## Contents

- [What works across tools](#what-works-across-tools)
- [Inspect the request offline](#inspect-the-request-offline)
- [Keep the key in the project root](#keep-the-key-in-the-project-root)
- [Run a bounded comparison first](#run-a-bounded-comparison-first)
  - [Re-run the benchmark when Jev or the catalog changes](#re-run-the-benchmark-when-jev-or-the-catalog-changes)
- [Enable API calls deliberately](#enable-api-calls-deliberately)
- [Optional automatic routing](#optional-automatic-routing)
- [Sources and verification limits](#sources-and-verification-limits)
<!-- reference-contents:end -->

## What works across tools

| Caller | Integration | Limit |
|---|---|---|
| Any agent or runner able to execute Python and pass JSON | `scripts/jev_router.py suggest` returns a typed suggestion | The caller decides whether and how to use it. |
| Codex and Claude Code | Optional `UserPromptSubmit` hook | Advisory mode supplies additional context after the host loads and trusts the hook. |
| Cursor | Not registered | `beforeSubmitPrompt` output cannot inject a suggestion into agent context, so a hook would only spend calls. Use the portable command instead. |
| A tool without command execution | Copy an offline request into the TypeSafe playground | No automatic integration. |

This selects bundled skills. It does not replace the coding model, launch arbitrary agents, or give one host access to another host's tools. Automatic lifecycle events still need host-specific adapters. See [HOOKS.md](HOOKS.md).

## Inspect the request offline

Run these commands from the source folder. In an installed project, replace `scripts/` with `.agents/scripts/`; the router, the evaluator, and the cases are installed only with `--with-jev`.

```bash
python3 -B scripts/jev_router.py catalog
python3 -B scripts/jev_router.py prepare <<'JSON'
{"request":"Correct our README installation instructions and remove generic prose."}
JSON
```

`catalog` lists the skills Jev may suggest; add `--catalog all` to list every local skill that is not deprecated. `prepare` prints the API body without reading `.env` or contacting TypeSafe. Only the supplied task and skill names/descriptions enter the body; skill bodies, project files, and transcripts are not collected. Local skill descriptions can still contain private information, so review the prepared body before sending it.

One request, using the pinned model `jev-1.13.0`, asks five questions about the same prompt. TypeSafe evaluates them in parallel and bills the input once, with output free, so they cost about the same as one:

- `suggested_skill` chooses one skill or `none`.
- `acts_on_files`, `needs_procedure`, and `prose_sufficient` are the yes/no gates from TypeSafe's [skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion). Their mean, with `prose_sufficient` inverted, must reach `JEV_MIN_GATE` (0.30 by default) before anything is suggested.
- `prompt_kind` classifies the message as `new_task`, `follow_up`, `correction`, `question`, `approval`, or `other`. Advice is injected only for a new task, never mid-task, and correction rates feed the evidence report.

If an answer to a gate or prompt-kind question is missing or malformed, routing falls back to the probability thresholds alone. Jev is offered only skills the model may use on its own: a skill with `disable-model-invocation: true` in its frontmatter, or `allow_implicit_invocation: false` in its `agents/openai.yaml`, is reserved for explicit invocation and never suggested. `JEV_CATALOG_SCOPE=all` offers every skill that is not deprecated, for evaluation; a deprecated skill only points to its replacement. Options appear in an order shuffled per turn, because Jev tends to favor the first option. Catalogs above 254 skills are rejected because `none` uses one of Jev's 255 choices. A prompt over 8,000 characters is sent as an excerpt of its first 6,000 and last 1,500 characters, and the serialized body is limited to 256 KiB. These bounds do not guarantee the provider's token limit for every language or custom catalog.

## Keep the key in the project root

For this source checkout, the local file is `MyNewAgent/.env`, beside `.env.example`. For an installed project, use `<project>/.env`, outside `.agents/`.

Copy `.env.example` only if a project `.env` does not already exist. For an existing `.env`, add the missing variables while preserving its contents. With `--with-jev`, an installed package includes `.agents/.env.example` as a template. The installer never copies the source `.env` or changes the project's `.env`.

```dotenv
TYPESAFE_API_KEY=your-local-key
JEV_ENABLED=false
JEV_MODE=shadow
JEV_MODEL=jev-1.13.0
JEV_TIMEOUT_SECONDS=3
JEV_MAX_REQUESTS_PER_SESSION=0
JEV_MAX_REQUESTS_PER_DAY=500
JEV_MIN_TOP_PROBABILITY=0.85
JEV_MIN_MARGIN=0.20
JEV_MIN_GATE=0.30
JEV_CATALOG_SCOPE=invocable
```

The daily cap covers every session in the project. Advisory mode injects a suggestion only for a new task, when Jev's top probability reaches `JEV_MIN_TOP_PROBABILITY`, leads the runner-up by at least `JEV_MIN_MARGIN`, and the gate mean reaches `JEV_MIN_GATE`. The first two defaults were fixed before the 2026-10-04 trial, the gate default comes from TypeSafe's cookbook, and none is yet calibrated for this package's skills. Shadow receipts and the evidence file keep the numbers needed to recalibrate them.

This repository ignores `.env` and `.env.*` while tracking `.env.example`. In another project, check its ignore rules before adding a key. Keep the key out of chat, source files, committed results, and client-side application code. Hosted runners can supply the same variables through their secret store instead.

Package validation rejects any nonempty key, token, secret, or password setting in the distributed `.env.example`, including `TYPESAFE_API_KEY`. It never opens `.env` or other private files. If a key has entered Git history, removing it from the current template does not revoke it; replace the exposed credential through TypeSafe before further use.

The router reads only the listed variables, with the same line parser as the prompt logger, so a quoted value may be followed by a comment. Existing process environment values take precedence. Values are literal; shell commands and variable interpolation never execute. Duplicate supported keys, unclosed quotes, malformed values, and symlinked `.env` files cause a safe fallback.

## Run a bounded comparison first

The 32 synthetic cases in `evaluations/jev/cases.jsonl` (installed with `--with-jev`) cover skill selection, ambiguous requests, and tasks needing no skill. Expected choices are proposed labels for review, not an independent benchmark. Several cases deliberately name a skill. Report those separately from harder inferred selections when interpreting results.

```bash
python3 -B scripts/evaluate_jev.py list
python3 -B scripts/evaluate_jev.py prepare --case readme-prose --field state
python3 -B scripts/evaluate_jev.py prepare --case readme-prose --field questions
```

Paste the last two outputs into the playground's State and Questions fields. Select the pinned model if the playground offers that control; otherwise record the actual model. The prepared request omits expected labels. A playground trial on 2026-10-03 returned an out-of-funds billing error before producing a model result. Do not count that as a wrong choice or successful trial.

For the baseline, give the same task and catalog to the coding agent without Jev or expected labels. Record the agent's chosen skill or `none` before opening the expected answers. Collect one result per source and case. Keep separate result files for different coding models, harnesses, or repeated runs so their results are not mixed.

The following illustrates the JSONL format only; these are not measured results:

```jsonl
{"id":"readme-prose","source":"baseline","choice":"unslop"}
{"id":"readme-prose","source":"jev","choice":"unslop"}
```

Save actual observations to a chosen local results file. Add `latency_ms` only when measured; use the same timing boundary for both sources. Extra fields such as `model`, `harness`, and `input_tokens` can preserve provenance, but the scorer does not aggregate them.

```bash
python3 -B scripts/evaluate_jev.py score --results /path/to/actual-results.jsonl
```

The report separates coverage, wrong choices, missed skills, unnecessary skills, and measured latency. Improvements and regressions compare only cases measured for both sources. Running `score` without a result file marks every case untested and leaves accuracy null. Failed or missing requests remain untested; record their errors separately.

Better routing accuracy alone does not establish better finished work. Before adopting advisory mode, repeat representative tasks with and without the suggestion and compare correctness, rework, elapsed time, and cost. Do not treat Jev's confidence as proof that a suggestion is correct.

### Re-run the benchmark when Jev or the catalog changes

`run` sends each case to Jev once, the way the hook does: the invocable catalog, the bundled questions, and an option order shuffled per case. It needs `--allow-network`, the key in `.env`, and a `--max-calls` cap that the folder can never exceed. Each request is reserved before it is sent and is never retried. Running the same command again resumes the folder: a case already sent is never sent again, even if it failed or was interrupted, and the rest continue. The folder refuses to mix in a different model, catalog, or case set. Cases whose expected skills the catalog does not offer are listed as out of scope instead of being sent. Usage goes to the project's usage ledger.

```bash
python3 -B scripts/evaluate_jev.py run --allow-network --max-calls 40 --out evaluations/jev/2026-10-05 --model jev-1.14.0
python3 -B scripts/evaluate_jev.py compare evaluations/jev/2026-10-03 evaluations/jev/2026-10-05
```

The folder keeps the exact catalog and cases it used, its observations, and `report.json`, with an exact 95% interval for accuracy. `compare` pairs two folders case by case, scores both against the newer folder's labels (or `--cases`), and follows `replaced_by` from deprecated skills so runs before and after a merge compare fairly. Its exact McNemar test says whether the cases one run got right and the other got wrong differ by more than chance. With 32 cases, only large differences are detectable. To change only the model, rerun with `--catalog-file` set to an earlier folder's `catalog.json` and, for the 2026-10-03 folder, `--legacy-request`.

## Enable API calls deliberately

After choosing a live-test allowance and adding funds/key, set `JEV_ENABLED=true` and a positive `JEV_MAX_REQUESTS_PER_SESSION` in the local configuration. Start in `shadow` mode. Shadow mode still consumes API credits when calls are enabled; it keeps suggestions out of native agent context.

The portable command additionally requires `--allow-network`:

```bash
python3 -B scripts/jev_router.py suggest --allow-network <<'JSON'
{"request":"Diagnose an intermittent parser failure.","session_id":"my-reviewed-trial-01"}
JSON
```

Without the flag, `suggest` stays offline and does not read credentials. The enabled flag, a positive request allowance, a key, and a stable session ID are all required before a network request. A disabled router reads only its settings: it parses no catalog and loads no network or database code. Explicit skill selections bypass Jev: portable callers can provide `explicit_skill`, and a known `$skill-name` or `/skill-name` anywhere in the prompt counts as explicit, so nothing is sent or injected. A skill name inside quotes or other text, such as `'$demo`, is not an invocation.

What leaves the machine: the prompt, redacted with the prompt logger's redactor and cut to the excerpt above, plus the names and descriptions of the skills Jev may suggest. If the part that would be sent needed redaction, nothing is sent, because secrets carry no routing signal. The router redacts only that part of a long paste, its opening and conclusion, each with at least a 64 KiB margin, so a secret far from both ends, which is never sent, does not stop routing. Short continuations such as `continue` or `yes`, and follow-up text produced by this package's own hooks, are skipped without spending an allowance slot. TypeSafe's model documentation states that Jev is not trained on customer requests or responses, and offers zero data retention to enterprise customers ([models](https://docs.typesafe.ai/models), checked 2026-10-04); read its privacy policy before enabling calls on private work.

The result has `status`, `mode`, and `suggested_skill`. A successful response also supplies confidence, probabilities, the top probability, the runner-up and its probability, the margin between them, actual model version, measured request latency, and input/output-token usage when provided by the API. It records usage in the private project ledger without assuming prices, linked to the turn's prompt-log entry when the host supplies a prompt or turn ID; `usage_recorded` reports whether that local write succeeded. Valid usage measurements are retained even when the routing suggestion is rejected; an invalid response model is recorded as `unreported`.

| Status | Meaning |
|---|---|
| `disabled` | Calls are off; nothing was read beyond settings. |
| `explicit` | The user named a skill; nothing was sent or injected. |
| `skipped` | `reason` is `continuation` or `sensitive`; no slot was spent. |
| `ok` | A confident answer; advisory mode may inject it. |
| `abstained` | `reason` is `low_probability`, `low_margin`, or `gate`; never injected, kept for calibration. |
| `missing_key`, `budget_exhausted` | No call; `reason` names `session_cap` or `daily_cap`. |
| `unavailable` | A fixed `reason` such as `invalid_configuration`, `http_401`, `http_402`, `http_429`, `http_5xx`, `timeout`, `tls`, `network`, or `invalid_response`. |

On failure, the caller should continue its ordinary skill selection. Suggestions are evidence, never permission to act or change policy.

Calls share an atomic local allowance by project and session ID, and every session in a project shares the daily cap. Failed attempts consume a slot and are not retried automatically. Reuse the same ID across collaborating callers to share an allowance; different IDs get different allowances. The counters are not an account spending cap and do not cover playground usage or other API clients. Temporary-state cleanup also resets them. Use provider billing controls for account-wide limits.

Requests go only to `https://api.typesafe.ai/v1/systemone`; redirects are rejected. Certificate and hostname verification remain required. On macOS, a Python installation with no configured CA bundle can use the system `/etc/ssl/cert.pem`; explicit process trust settings remain respected. `JEV_TIMEOUT_SECONDS` limits socket operations, not the entire elapsed request. Native registrations also have a 15-second host timeout; a routing call normally takes about 0.3 seconds. Other callers should impose their own process deadline. Cancellation and missing network access should leave ordinary agent work available.

At TypeSafe's published price checked on 2026-10-03, Jev costs $0.042 per million input tokens and output is free. A hypothetical 32-case run at 10,000 input tokens per case costs about $0.013. Measure actual usage and recheck pricing before larger runs; coding-agent comparison costs are separate.

## Optional automatic routing

Jev is an optional install component. Install it into a project, then register its prompt hook there:

```bash
bash /path/to/MyNewAgent/setup.sh --with-jev /path/to/project
cd /path/to/project
python3 -B .agents/scripts/setup_hooks.py --harness claude --jev --local .
```

`--local` keeps the network-capable hook in your own `.claude/settings.local.json` rather than the shared settings, so collaborators are not opted in. A later registration without `--local` keeps writing there, with any Jev opt-in; to move the hooks back to the shared settings, run `--remove` first. If both settings files register these hooks, setup stops and asks for `--local` or `--remove` instead of guessing. If the local file cannot be read and might hold them, setup stops until you repair or delete that file. Setup warns while Git would commit the local file, and the installer adds the ignore rule. Codex has no local hook file; use `--harness codex --jev` only in a project where everyone who trusts its `.codex/hooks.json` wants Jev. When the shared settings already hold the package's hooks and should keep them, `--jev-local` adds only the Jev hook to `.claude/settings.local.json` and never changes the shared file. Later registrations keep that split and keep the local Jev hook on the current bootstrap; `--jev` without `--local` also keeps it local. If the shared settings already register Jev, `--jev-local` adds nothing, because a second copy would call Jev twice per prompt. `--jev-local --remove` removes only the local Jev hook, and `--jev-local` cannot be combined with `--local`. In this source folder, use `scripts/setup_hooks.py --harness claude --jev-local .`; its tracked configurations deliberately register no Jev hook. Registration adds the hook for Codex and Claude Code only, preserves unrelated handlers, and backs up replaced configurations. It prepares commands with network permission, but the router still requires the local enabled flag, positive allowance, and key before calling TypeSafe. Review Codex hooks through `/hooks`, and check the active host's diagnostics after starting a fresh session.

Ordinary registration without `--jev` keeps an already registered Jev hook, in whichever Claude settings file holds the registration, and moves it to the current bootstrap. Set `JEV_ENABLED=false` to stop calls. `setup_hooks.py --harness all --remove .` removes this package's lifecycle and Jev registrations while retaining unrelated handlers.

Native hooks save bounded local receipts for routed, skipped, and failed calls. Inspect them with the actual host session ID; `history` finds the project root from any subdirectory:

```bash
python3 -B scripts/jev_router.py history <<'JSON'
{"session_id":"actual-host-session-id"}
JSON
```

Receipts retain status, reason, mode, selected skill, confidence, top probability, runner-up and its probability, margin, option count, catalog fingerprint and scope, a hashed turn key, whether the prompt was excerpted, actual model, latency, total hook time, usage, and time when available. They contain no prompt, path, API key, raw response, or transcript. The private temporary SQLite store retains the newest 1,000 receipts across projects and returns at most 100 for the selected project/session. Receipts may disappear with temporary-file cleanup. Portable `suggest` callers receive JSON directly and manage their own saved results.

The durable record is the project's `.agent-evidence.jsonl`. Every routing decision of an enabled router, from the hook or a portable `suggest` call, is appended with its status, choice, decision numbers, and hashed session and turn. Registered hooks add the skills the agent actually loads. That makes shadow mode an experiment that costs no coding-model tokens: run it during normal work, then let `python3 -B scripts/evidence.py report --format markdown` compare Jev's suggestions with what the agent loaded, and show coverage and agreement at different thresholds. Before you consider advisory mode, review the disagreements yourself, ideally over a few hundred turns; [USAGE.md](USAGE.md#review-skill-usage-and-routing-evidence) explains the report.

## Sources and verification limits

The 2026-10-04 source-only opportunity trial is saved under `evaluations/jev/opportunities/REPORT.md`. It evaluates optional context selection and classification of synthetic test/browser text observations, with eight reversed-option checks. Its 32 calls reported 68,550 input and 2,843 output tokens, costing $0.002879100 at the verified input rate. No browser execution, screenshot interpretation, model switching, or net coding-agent savings was established. The experiment tooling is not installed into consumer projects and does not change this skill-suggestion hook. Ordinary search and diagnosis remain available.

- [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart) defines the endpoint, authentication, and response shape.
- [Choice questions](https://docs.typesafe.ai/primitives/choice) defines the option limit and probability distribution.
- [Models and pricing](https://docs.typesafe.ai/models) lists model IDs, token limits, and current pricing.
- [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents) explains its decision-model role.
- [Skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion) motivates evaluation; its results do not establish improvement for this package.

Automated tests use synthetic credentials and replace external HTTP. They verify offline defaults, request gating, local allowances, malformed responses, receipt privacy, host output contracts, and evaluation arithmetic. They do not establish live API success or actual event dispatch in every host version.

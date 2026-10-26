---
name: threat-intel
description: "Research current vulnerabilities, exploits, and threat landscape from 7 trusted sources. Cross-references against your project's actual dependencies and tech stack. Results are cached for 24 hours. Use when the user says 'check for threats', 'what vulnerabilities are out there', 'CVE check', 'threat landscape', or wants to stay current on security risks."
metadata:
  source: original
  status: stable
  reviewed: 2026-10-04
---

# Threat Intelligence

Research current vulnerabilities, exploits, and emerging threats from trusted sources. Match findings against the project's actual technology stack. Cache results. Report with citations.

## Prerequisite skills

- Read and follow the `safe-research` rule and skill for all external queries. This skill dispatches multiple research subagents — every one of them follows the safe-research guardrails.

## Sources (7 total)

### Tier 1 — high trust

| Source | URL | Data | Query method |
|--------|-----|------|-------------|
| NVD/CVE | nvd.nist.gov | CVE details, CVSS scores, affected products, references | REST API (`https://services.nvd.nist.gov/rest/json/cves/2.0`) |
| CISA KEV | cisa.gov/known-exploited-vulnerabilities-catalog | Actively exploited CVEs, remediation deadlines | JSON feed (`https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`) |
| OWASP | owasp.org | Top 10, cheat sheets, testing guides, attack descriptions | Web search + page read |
| GitHub Advisories | github.com/advisories | Package-specific advisories, severity, patches, affected versions | Web search (`https://github.com/advisories?query=`) |

### Tier 2 — moderate trust

| Source | URL | Data | Query method |
|--------|-----|------|-------------|
| Snyk | security.snyk.io | Vulnerability database, remediation advice, exploit maturity | Web search + page read |
| HackerOne | hackerone.com/hacktivity | Disclosed bug reports, real-world exploitation patterns | Web search + page read |

### Tier 3 — verify before use

| Source | URL | Data | Query method |
|--------|-----|------|-------------|
| Exploit-DB | exploit-db.com | Proof-of-concept exploits, shellcode, technical details | Web search + page read |

Tier 3 findings are used for exploit technical details only. Never as the sole source for a vulnerability claim.

## Workflow

1. **Scope** — Determine what to research:
   - Read the project's dependency files (`package.json`, `requirements.txt`, `Cargo.toml`, etc.).
   - Identify the technology stack (framework, language, runtime, database, auth library).
   - User optionally specifies: timeframe (last 7/30/90 days), focus areas, specific CVE IDs.

2. **Check cache** — Look in `.agents/.threat-intel-cache/` for recent results.
   - If cache exists and is less than 24 hours old, use cached results.
   - If user requests "re-fetch", "refresh", or "check for new threats", bypass cache.
   - If cache is stale (>24 hours), dispatch fresh research.

3. **Dispatch research subagents** — Send one subagent per source (or batch related sources).
   - Follow the `safe-research` skill dispatch procedures exactly.
   - Each subagent gets a specific query scoped to the project's technology stack.
   - Each subagent returns structured data in the result schema below.

4. **Result schema** — Every finding returned by a research subagent must fit:
   ```
   - cve_id: (if applicable)
   - title: Short description
   - severity: Critical / High / Medium / Low
   - cvss_score: (if available)
   - affected_product: Package or technology name
   - affected_versions: Version range
   - patched_version: (if available)
   - description: What the vulnerability is
   - exploit_available: yes / no / unknown
   - actively_exploited: yes / no / unknown
   - source_url: Where this was found
   - source_tier: 1 / 2 / 3
   - date_published: When it was disclosed
   ```

5. **Correlate** — Cross-reference findings across sources.
   - A CVE in NVD + CISA KEV = high priority (actively exploited).
   - A CVE in NVD + Snyk with exploit available = high priority.
   - A finding from Tier 3 only = flag as unverified.
   - Deduplicate across sources (same CVE from multiple sources = one finding with multiple citations).

6. **Relevance filter** — Match against the project's actual state.
   - Check if the affected package is in the project's dependencies.
   - Check if the affected version matches the project's installed version.
   - Check if the vulnerability applies to the project's usage pattern (e.g., a server-side vulnerability in a package used only client-side).
   - Discard findings that don't match the project.

7. **Brief** — Produce a threat intelligence brief:
   ```
   ## Threat Intelligence Brief — [Project Name]
   Generated: [timestamp]
   Sources checked: [list]
   Cache status: fresh / cached (age)
   
   ### Critical Threats (action required)
   Vulnerabilities actively exploited or with public exploits affecting your dependencies.
   
   ### High Priority
   Severe vulnerabilities in your stack with patches available.
   
   ### Monitoring
   Emerging threats or low-severity findings worth tracking.
   
   ### Stack Assessment
   Overall security posture of your technology choices.
   ```

## Caching

- Cache directory: `.agents/.threat-intel-cache/`
- Cache format: One JSON file per research run, named `{date}-{stack-hash}.json`.
- Default validity: 24 hours.
- User can force refresh at any time.
- Cache entries include: query parameters, timestamp, sources checked, all results, and confidence assessments.

## Automated triggers

This skill auto-dispatches research when:
- The `security-audit` skill finds a CVE it has no context for.
- The user asks about a specific vulnerability or threat pattern.
- A dependency update introduces a new version and the agent wants to check for known issues.

## Auth-specific threat monitoring

For projects using authentication libraries, additionally check:
- **Passport.js**: Known strategy vulnerabilities, session handling CVEs, callback validation issues.
- **OAuth 2.0 / OIDC providers**: Authorization server vulnerabilities, token endpoint issues, PKCE bypass advisories.
- **JWT libraries**: Algorithm confusion CVEs, key handling issues, known bypasses for specific library versions.

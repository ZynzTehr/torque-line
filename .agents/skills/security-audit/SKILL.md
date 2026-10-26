---
name: security-audit
description: "Scan a codebase for security vulnerabilities across all attack surfaces (web, API, deps, infra, agent/AI, auth). Produces a classified findings report with remediation diffs. Use when the user says 'audit', 'scan for vulnerabilities', 'security review', 'check for security issues', or wants to harden a project."
metadata:
  source: original
  status: stable
  reviewed: 2026-10-04
---

# Security Audit

Scan a codebase for vulnerabilities. Classify findings by severity. Produce actionable reports with remediation code.

## Prerequisite skills

- Read and follow the `safe-research` rule and skill when checking external databases (NVD, GitHub Advisories) during the audit.

## Attack surfaces

### Web applications

- **XSS**: Reflected, stored, DOM-based. Look for `innerHTML`, `dangerouslySetInnerHTML`, unescaped template interpolation, `document.write`, user input in `href`/`src` attributes.
- **CSRF**: Missing CSRF tokens on state-changing endpoints. Check form submissions, API mutations without anti-CSRF headers.
- **SSRF**: User-controlled URLs passed to server-side HTTP clients (`fetch`, `axios`, `http.request`). Check for internal network access (169.254.169.254, localhost, private ranges).
- **Open redirects**: User-controlled redirect targets without allowlist validation. Check `res.redirect(req.query.next)` patterns.
- **CSP**: Missing or overly permissive Content-Security-Policy. Check for `unsafe-inline`, `unsafe-eval`, wildcard origins.
- **Cookies**: Missing `httpOnly`, `secure`, `sameSite` flags on session cookies.

### APIs

- **Broken authentication**: Missing auth middleware on protected routes. Endpoints that skip token validation.
- **Mass assignment**: Request body spread directly into database models without field allowlisting (`Object.assign`, spread operator on request body into ORM).
- **BOLA/IDOR**: Object references (IDs, slugs) in URLs without ownership checks. Check if user A can access user B's resources by changing the ID.
- **Rate limiting**: Missing rate limiting on authentication, password reset, OTP verification, and any endpoint that sends email/SMS.
- **JWT misconfigurations**: `alg: none` accepted, symmetric key confusion (RS256 → HS256), missing expiration, overly long lifetimes, secrets in code.
- **Exposed debug endpoints**: `/debug`, `/graphql` introspection, `/swagger`, `/__testing__` in production configs.

### Authentication and OAuth

- **Passport.js**: Strategy misconfiguration, missing `serializeUser`/`deserializeUser` validation, session fixation after login (session not regenerated), callback URL validation.
- **OAuth 2.0 flows**: Missing `state` parameter (CSRF), authorization code injection, PKCE not enforced on public clients, token leakage via HTTP referer, overly broad scopes, redirect_uri open redirectors, implicit flow in use (deprecated).
- **OIDC**: ID token signature not validated, nonce replay, issuer not checked, audience not validated, `at_hash` not verified.
- **Password storage**: Plaintext, MD5, SHA-1/256 without salt. Only bcrypt, scrypt, or argon2 are acceptable.
- **Session management**: Session not invalidated on logout or password change, session ID in URL, missing expiration.

### Dependencies

- **Known CVEs**: Run the project's audit command (`npm audit`, `pip-audit`, `cargo audit`, `bundler-audit`, `dotnet list package --vulnerable`). Triage findings by CVSS and exploitability.
- **Unmaintained packages**: Flag dependencies with no updates in 2+ years, low download counts, or archived repositories.
- **Typosquatting**: Check for package names that are slight misspellings of popular packages.
- **Supply chain**: Check for install scripts (`preinstall`, `postinstall`) in dependencies. Flag unexpected network calls during build.

### Infrastructure

- **Docker**: Running as root, exposed ports, secrets in build args or environment, unpatched base images, privileged mode.
- **IaC (Terraform, CloudFormation)**: Public S3 buckets, security groups with 0.0.0.0/0, unencrypted storage, missing logging.
- **Default credentials**: Check for admin/admin, root/root, default API keys in config files and docker-compose.

### Agent and AI

- **Prompt injection**: User input that reaches system prompts without sanitization. Check for direct and indirect injection vectors.
- **MCP tool misuse**: Tools with excessive permissions, missing input validation on tool parameters, tools that expose filesystem or network access without restrictions.
- **Data exfiltration**: Agent outputs that could leak secrets, internal paths, or sensitive data through tool responses.
- **System prompt exposure**: Check if system prompts can be extracted through conversation.

## Workflow

1. **Discover** — Detect project type, framework, language, dependency manager, and deployment target.
   - Check for `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Gemfile`, `.csproj`.
   - Check for `Dockerfile`, `docker-compose.yml`, terraform files, `serverless.yml`.
   - Check for `.agents/`, `AGENTS.md`, MCP configs, skill files.

2. **Scan** — Walk the codebase checking for vulnerability patterns per surface. Use grep for static patterns, AST analysis for structural issues.
   - Run dependency audit commands.
   - Check config files for security misconfigurations.
   - Check auth middleware coverage on routes.
   - If uncertain about a pattern's exploitability, dispatch a research subagent (following `safe-research`) to check if it matches a known CVE or attack technique.

3. **Classify** — Rate each finding:
   - **Critical**: Exploitable remotely, no auth required, leads to data breach or RCE. (e.g., SQL injection, exposed admin panel, hardcoded production secrets)
   - **High**: Exploitable with some conditions, leads to auth bypass or significant data access. (e.g., JWT alg confusion, IDOR, SSRF to cloud metadata)
   - **Medium**: Exploitable but with limited impact or requiring authenticated access. (e.g., stored XSS in admin panel, missing rate limiting, permissive CORS)
   - **Low**: Best-practice violation with minimal direct exploitability. (e.g., missing security headers, verbose error messages, unused dependency with low-severity CVE)
   - **Info**: Observation worth noting but not a vulnerability. (e.g., deprecated API usage, missing HSTS preload)

4. **Report** — Produce a structured findings report:
   ```
   ## Security Audit Report — [Project Name]
   
   ### Summary
   | Severity | Count |
   |----------|-------|
   | Critical | X     |
   | High     | X     |
   | Medium   | X     |
   | Low      | X     |
   | Info     | X     |
   
   ### Findings
   
   #### [SEVERITY] Title — CWE-XXX
   - **File:** `path/to/file.ts:line`
   - **Pattern:** What the vulnerable code does
   - **Exploit:** How an attacker would exploit it
   - **Impact:** What happens if exploited
   - **Fix:** Recommended remediation with code diff
   ```

5. **Remediate** — For each finding, offer a fix with a code diff. User approves per-finding. Apply only approved fixes.

6. **Verify** — Re-scan after fixes to confirm each finding is resolved. Report any that remain.

## Automated research triggers

During scanning, if the agent encounters:
- A CVE ID in an audit report it has no context for → dispatch research subagent to NVD/GitHub Advisories.
- A code pattern that might be vulnerable but the agent is uncertain → dispatch research subagent to OWASP/CWE database.
- A dependency it doesn't recognize → dispatch research subagent to check package reputation and known issues.

After research, if uncertainty remains, report it: "Found [pattern] in [file]. This may be vulnerable to [attack] based on [source], but I could not confirm exploitability. Recommend manual review."

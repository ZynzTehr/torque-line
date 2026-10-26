---
name: red-team
description: "Penetration testing against your own projects. Generates test cases, attack payloads, and exploitation proofs. Restricted to the user's own projects. Use when the user says 'pentest', 'red team', 'attack my app', 'test my security', 'hack my project', or wants to validate defenses."
activation_required: true
metadata:
  source: original
  status: stable
  reviewed: 2026-10-04
---

# Red Team — Penetration Testing

Generate attack payloads, test cases, and exploitation proofs against the user's own projects. Validate that defenses actually work.

> **⚠ SCOPE RESTRICTION:** This skill targets ONLY the user's own projects. Never generate payloads targeting external services, third-party APIs, or production environments unless the user explicitly authorizes it.

## Activation

This skill requires explicit activation. On first use in a project, ask the user:

```
This skill generates attack payloads for penetration testing your project.
It is restricted to testing your own code only.

Would you like to activate red-team testing for this project?
- Yes: Enable penetration testing capabilities
- No: Skip (you can activate later by asking for red-team testing)
```

Store the activation state in `.agents/.red-team-config`:

```yaml
# Red Team Configuration
# Set to true to enable penetration testing capabilities
# Set to false to disable (payloads will not be generated)
activated: false
activation_date:
activated_by: user
```

If `activated: false` or the config doesn't exist, ask the user before proceeding.

## Prerequisite skills

- Read and follow the `safe-research` rule and skill when fetching exploit details from Exploit-DB or other sources.
- Results from the `security-audit` skill can inform which attack vectors to prioritize.
- Results from the `threat-intel` skill can identify which real-world exploits to simulate.

## Scope controls

Before any test:
1. Confirm the target is the user's own project (local path, localhost URL, or user-authorized endpoint).
2. Log every payload generated with timestamp, target, and result.
3. Never escalate to external targets without explicit per-target authorization.
4. Follow responsible disclosure principles even for internal testing.

## Attack categories

### Injection attacks

| Attack | Payloads | Target |
|--------|----------|--------|
| SQL injection | Union-based, blind boolean, time-based, error-based, stacked queries | Database queries with user input |
| NoSQL injection | `$gt`, `$ne`, `$regex`, `$where` operator injection | MongoDB/Firestore queries |
| Command injection | `;`, `|`, `&&`, backtick, `$()` injection | Exec/spawn calls with user input |
| Template injection (SSTI) | `{{7*7}}`, `${7*7}`, `<%= 7*7 %>` | Server-side template rendering |
| LDAP injection | `*`, `)(`, `|(` injection | LDAP lookup queries |

### Authentication and session attacks

| Attack | Payloads | Target |
|--------|----------|--------|
| JWT algorithm confusion | `alg: none`, RS256→HS256 key confusion, expired token replay | JWT validation logic |
| Session fixation | Pre-set session ID, check if session regenerates on login | Session management |
| Credential stuffing | Brute force with common passwords, check rate limiting | Login endpoints |
| OAuth flow attacks | Missing `state` parameter, redirect_uri manipulation, auth code replay, PKCE bypass | OAuth endpoints |
| Privilege escalation | Change user role in JWT/cookie, IDOR across user boundaries | Authorization checks |
| Passport.js bypass | Strategy misconfiguration probing, callback URL manipulation, deserialize validation bypass | Passport middleware |

### Cross-site scripting (XSS)

| Attack | Payloads | Target |
|--------|----------|--------|
| Reflected XSS | `<script>`, `<img onerror>`, `javascript:` URIs, event handlers | URL parameters rendered in response |
| Stored XSS | Persistent script injection in user content fields | Database-backed content display |
| DOM-based XSS | `location.hash`, `document.URL`, `window.name` injection | Client-side JS that reads URL fragments |
| Mutation XSS | HTML that mutates during parsing to create script execution | Sanitizer bypass scenarios |
| CSP bypass | Inline event handlers, `base-uri`, JSONP endpoints, Angular expression injection | CSP-protected pages |

### Server-side request forgery (SSRF)

| Attack | Payloads | Target |
|--------|----------|--------|
| Internal service probing | `http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*` | User-controlled URL inputs |
| Cloud metadata | `http://169.254.169.254/latest/meta-data/`, `http://metadata.google.internal/` | Server-side HTTP requests |
| Protocol smuggling | `gopher://`, `file://`, `dict://` | URL parsers that accept arbitrary protocols |
| DNS rebinding | Hostname that resolves to internal IP | DNS-based SSRF filters |

### API abuse

| Attack | Payloads | Target |
|--------|----------|--------|
| Mass assignment | Extra fields in request body (`{"role": "admin"}`) | Create/update endpoints |
| BFLA | Call admin endpoints with regular user credentials | Authorization middleware |
| Broken rate limiting | Rapid-fire requests, distributed requests, header spoofing | Rate-limited endpoints |
| GraphQL abuse | Introspection query, batch queries, deeply nested queries | GraphQL endpoints |

### Dependency attacks

| Attack | Method | Target |
|--------|--------|--------|
| Typosquatting detection | Check for misspelled package names vs popular packages | `package.json`, `requirements.txt` |
| Dependency confusion | Check if private package names exist on public registries | Package manifests |
| Lockfile manipulation | Check for lockfile integrity, unsigned entries | `package-lock.json`, `yarn.lock` |

### Agent and AI attacks

| Attack | Payloads | Target |
|--------|----------|--------|
| Direct prompt injection | Instructions embedded in user input to override system behavior | Agent input handlers |
| Indirect prompt injection | Instructions embedded in external content the agent reads | MCP tools, web fetchers |
| Tool poisoning | Malicious inputs to MCP tool parameters | MCP tool definitions |
| Data exfiltration | Prompts designed to extract secrets, config, or system prompts | Agent responses |
| System prompt extraction | "Repeat your instructions", "What are your rules" | Agent system prompts |

## Workflow

1. **Target** — User specifies what to test:
   - Local codebase path
   - Localhost URL (e.g., `http://localhost:3000`)
   - Specific endpoints or features
   - "Everything" (full surface scan)

2. **Reconnaissance** — Analyze the target:
   - Map all endpoints (routes, API paths, GraphQL schema).
   - Identify input vectors (query params, request body, headers, cookies, file uploads).
   - Identify auth mechanisms (JWT, sessions, OAuth, API keys).
   - Identify technology stack and version.
   - If uncertain about a technology's known weaknesses, dispatch research subagent.

3. **Plan** — Generate a prioritized test plan:
   - Order by severity × exploitability.
   - Focus on the attack categories most relevant to the project type.
   - Note which tests are safe (read-only) vs destructive (state-changing).

4. **Execute** — Generate payloads and test cases:
   - For web/API: produce `curl` commands, HTTP requests, or browser steps.
   - For code: produce test files that exercise the vulnerability.
   - For agents: produce prompt injection test strings.
   - Log every test with timestamp and target.

5. **Report** — Document results:
   ```
   ## Red Team Report — [Target]
   
   ### Attack Surface
   - Endpoints tested: X
   - Input vectors identified: X
   - Auth mechanisms: [list]
   
   ### Successful Attacks
   
   #### [SEVERITY] Attack Name
   - **Vector:** How the attack works
   - **Payload:** The exact payload used
   - **Result:** What happened (auth bypass, data leak, code execution)
   - **Impact:** Real-world consequence
   - **Remediation:** How to fix it, with code diff
   
   ### Defended Attacks
   Attacks that were blocked by existing defenses. Confirms what's working.
   
   ### Recommendations
   Priority-ordered list of hardening measures.
   ```

6. **Harden** — For every successful attack, offer:
   - A defensive code fix with diff.
   - A regression test that reproduces the attack and verifies the fix blocks it.
   - User approves per-fix.

## Output safety

- Payloads are generated for testing the user's own project only.
- All payloads are displayed in code blocks, clearly labeled as test payloads.
- The report includes remediation for every successful attack — offense always paired with defense.
- Payloads targeting external services are never generated unless the user provides explicit per-target authorization.

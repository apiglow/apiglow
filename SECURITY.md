# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** through
[GitHub Security Advisories](../../security/advisories/new)
("Report a vulnerability" in the repository's **Security** tab).
Do not open a public issue for a security problem.

You can expect an acknowledgment within a few days. Please include a
reproduction (an OpenAPI schema sample or config snippet is usually enough)
and the impact as you understand it.

## Scope notes

Things that are **by design**, documented, and not vulnerabilities per se:

- Sensitive variables are stored in clear text on the user's device
  (localStorage/IndexedDB); the UI displays a disclaimer. There is no
  server, so there is nothing else to encrypt against.
- `openapi.hide` / `x-apiglow-hide` is documentation-level hiding, not
  access control: the schema is still downloaded in full by the browser.
- The try-it sends real requests from the browser; CORS behavior belongs to
  the target API.

Reports about DOMPurify bypasses, script injection through schema/Markdown/
scenario content, sensitive-value leaks in exports or share links, or any
way a shared link/file executes or writes without a user gesture are very
much in scope.

## Supported versions

Only the latest released version is supported.

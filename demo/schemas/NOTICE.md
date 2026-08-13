# Third-party schemas

## `github.json`

GitHub's official OpenAPI description of the REST API, used as the demo's
real-world witness spec — a large document written by another organization,
frozen so the demo never drifts under us.

- Upstream: <https://github.com/github/rest-api-description>, file
  `descriptions/api.github.com/api.github.com.json`
- Pinned at upstream commit `b26c240ded1c8b79cb0fb09dee4a21239061fa23`
  (document `info.version` 1.1.4, OpenAPI 3.0.3)
- License: MIT (declared by the document's own `info.license` and the
  upstream repository)

The file is verbatim upstream — no edits. To refresh, download the same
path at a newer commit and update the pin above.

## `petstore.json`

Based on the official [Swagger Petstore](https://petstore3.swagger.io)
sample (Apache-2.0), heavily rewritten for the demo: extra auth schemes,
OpenAPI 3.2 constructs, the failure showcase and same-origin servers. It is
maintained in this repository and no longer tracks upstream.

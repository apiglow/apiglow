---
title: Getting started
description: Frontmatter written for another tool is stripped, not rendered.
---

# Getting started

Welcome to the **Petstore API** guide. This page is rendered from a plain
Markdown file declared in the host page config (`docsPages`).

## Authentication

Most endpoints accept an API key header. Pick an environment, add the
suggested `auth.api_key` variable, and the header is injected automatically:

```bash cURL
curl -X GET '/demo-api/v3/pet/10' \
  -H 'api_key: your-key-here'
```
```js Node.js
await fetch('/demo-api/v3/pet/10', {
  headers: { api_key: 'your-key-here' },
})
```
```python Python
requests.get('/demo-api/v3/pet/10', headers={'api_key': 'your-key-here'})
```

> [!NOTE]
> The demo ships an environment with every credential prefilled — the mocked
> API verifies none of them, it only reflects what you send.

## Sending your first request

1. Pick an environment in the header switcher.
2. Open an operation in the left navigation — say
   [get a pet by id](apidoc:getPetById).
3. Fill the parameters and press **Send**.

The response is stored in the local history — nothing ever leaves your
browser.

```json
{
  "id": 1,
  "name": "Rex",
  "status": "available"
}
```

## Troubleshooting

> [!WARNING]
> If a request fails before reaching the server, it is usually a CORS
> restriction on the API side, not a bug in this documentation app.

> [!CAUTION]
> [Deleting a pet](apidoc:DELETE /pet/{petId}) is not reversible, even in the
> sandbox: the record is gone until the browser recycles the mock data.

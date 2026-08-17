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
> The demo ships an environment with every credential prefilled. The mocked
> API verifies none of them — except
> [the protected showcase endpoint](<apidoc:GET /failures/protected>), which
> really enforces the prefilled `auth.bearerAuth`: clear the variable and
> watch the 401.

## Sending your first request

<Steps>

<Step title="Pick an environment">
Use the switcher in the header. The demo one is prefilled.
</Step>

<Step title="Open an operation">
Anything in the left navigation — say [get a pet by id](apidoc:getPetById).
</Step>

<Step title="Fill and send">
Complete the parameters and press **Send**.
</Step>

</Steps>

The response is stored in the local history — nothing ever leaves your
browser.

```json
{
  "id": 1,
  "name": "Rex",
  "status": "available"
}
```

## Where the API lives

<Tabs>

<Tab label="This demo">
Nothing to install: the Petstore answering you is a service worker running in
your own browser. Pick **demo (mocked API)** and send.
</Tab>

<Tab label="Your own API">
Point the environment at your base URL and the same page drives it. The only
thing the browser needs from you is CORS.

```bash
Access-Control-Allow-Origin: https://docs.example.com
```
</Tab>

</Tabs>

## Troubleshooting

> [!WARNING]
> If a request fails before reaching the server, it is usually a CORS
> restriction on the API side, not a bug in this documentation app — see it
> live on [the CORS showcase](<apidoc:GET /failures/cors>).

> [!CAUTION]
> [Deleting a pet](apidoc:DELETE /pet/{petId}) is not reversible, even in the
> sandbox: the record is gone until the browser recycles the mock data.

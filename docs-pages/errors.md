# Errors

Every failure of this API comes back as the same JSON body: a numeric
`code` repeating the HTTP status, a stable machine-readable `type`, and a
human-readable `message`.

```json
{
  "code": 404,
  "type": "error",
  "message": "Pet not found"
}
```

Validation failures carry one more field — `errors[]`, one entry per
rejected value, each with a JSON Pointer into the request body. Try it on
[the validation showcase](<apidoc:POST /failures/validation>): send a
payload without an `@` in `email` and read the 422.

## See each failure for real

The **Failure showcase** tag groups endpoints whose only job is to fail
honestly — what you see there is what your own errors will look like:

| Status | Endpoint | What it demonstrates |
|---|---|---|
| `500` | [server-error](<apidoc:GET /failures/server-error>) | An unhandled crash, standard `Error` body |
| `503` | [unavailable](<apidoc:GET /failures/unavailable>) | `Retry-After`, counted down in the response panel |
| `429` | [rate-limit](<apidoc:GET /failures/rate-limit>) | An exhausted quota: `RateLimit-Remaining: 0` plus `Retry-After` |
| `401` | [protected](<apidoc:GET /failures/protected>) | Auth wall — succeeds only with `auth.bearerAuth` from the prefilled environment |
| `403` | [forbidden](<apidoc:GET /failures/forbidden>) | Authenticated but not authorized: the valid token still gets refused |
| `422` | [validation](<apidoc:POST /failures/validation>) | The structured `errors[]` body |

## Retrying

> [!TIP]
> Log the `code` and `type`, show the `message`. The first two are stable
> across releases; the wording is not.

A `503` or `429` names its own retry delay — honour `Retry-After` instead
of guessing:

```bash cURL
curl --retry 3 --retry-delay 30 '/demo-api/v3/failures/unavailable'
```
```js Node.js
for (let attempt = 0; attempt < 3; attempt += 1) {
  const response = await fetch('/demo-api/v3/failures/unavailable')
  if (response.ok) break
  const wait = Number(response.headers.get('retry-after') ?? 2 ** attempt) * 1000
  await new Promise((r) => setTimeout(r, wait))
}
```

> [!CAUTION]
> Never retry a `400` or a `422`. The request is wrong, and sending it
> again three times only costs you your rate limit.

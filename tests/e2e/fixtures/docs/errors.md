# Errors

Every failure comes back as a JSON body with a `code` and a `message`.

> [!TIP]
> Log the `code`, show the `message`.

> [!IMPORTANT]
> The `code` is stable; the `message` is not.

> [!CAUTION]
> Never retry a `400` — the request itself is wrong.

## Status codes

`400` for a malformed request, `404` for a missing resource, `500` when we
broke something.

## Retrying

Retry `500`s with a backoff.

```bash cURL
curl --retry 3 https://api.e2e.test/v1/pets
```
```js Node.js
await retry(() => fetch('https://api.e2e.test/v1/pets'), { attempts: 3 })
```

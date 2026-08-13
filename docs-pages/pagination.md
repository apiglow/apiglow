# Pagination

[Find pets by status](apidoc:GET /pet/findByStatus) returns one page at a
time. Its `page` parameter selects the page, starting at 1 — out-of-range
values clamp to the nearest page instead of erroring.

```apidoc:operation
GET /pet/findByStatus
```

```bash cURL
curl '/demo-api/v3/pet/findByStatus?status=available&page=2'
```
```js Node.js
await fetch('/demo-api/v3/pet/findByStatus?status=available&page=2')
```
```python Python
requests.get('/demo-api/v3/pet/findByStatus',
             params={'status': 'available', 'page': 2})
```

## Walking forward

Every page carries a `Link` response header with `next`, `prev`, `first`
and `last` relations — the documentation's response panel turns them into
follow buttons.

> [!IMPORTANT]
> Page through a collection with the links the previous response gave you,
> never with an offset you computed yourself: items added while you read
> would shift every page after the one you are on.

> [!NOTE]
> The sandbox seeds four pets and serves **one pet per page**, so the link
> relations are worth watching even on the first request.

## Empty pages

An empty page is a `200` with an empty array, never a `404`: the collection
exists, it just has nothing left to give.

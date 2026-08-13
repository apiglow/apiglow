---
title: ignored by design
draft: true
---

# Pagination

Collection endpoints return a page at a time.

> [!NOTE]
> Cursors are opaque. Never build one yourself.

> [!WARNING]
> A cursor expires after an hour.

## Cursors

Pass the `cursor` returned by the previous call to walk forward. A cursor is
an opaque string; treat it as a token, not as an offset.

```bash cURL
curl https://api.e2e.test/v1/pets?cursor=abc
```
```js Node.js
await fetch('https://api.e2e.test/v1/pets?cursor=abc')
```
```python Python
requests.get('https://api.e2e.test/v1/pets', params={'cursor': 'abc'})
```

## Page size

The `limit` parameter caps the number of items in one response.

```bash cURL
curl https://api.e2e.test/v1/pets?limit=10
```
```python Python
requests.get('https://api.e2e.test/v1/pets', params={'limit': 10})
```

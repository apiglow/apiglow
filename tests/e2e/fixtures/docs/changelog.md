# Changelog

Notable changes to the E2E API, newest release on top.

## 1.1.0 — 2026-06-01

Added a `status` filter to the pet listing.

```bash
curl https://api.e2e.test/v1/pets?status=available
```

## 1.0.1 — 2026-05-10

- Fixed a wrong `404` on pets created moments earlier.

## 1.0.0 — 2026-05-01

Initial release: pets, orders, account.

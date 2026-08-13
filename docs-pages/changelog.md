# Changelog

## 1.0.27

- Switched the pet store to the *design-first* approach.
- New: [search pets](apidoc:searchPets) reads a structured filter body — a
  `QUERY` request, so the criteria travel in the body of a read.
- [Filter pets](apidoc:filterPets) accepts an RSQL expression as its raw
  query string.

## 1.0.26

- Fixed pagination on [find pets by status](apidoc:GET /pet/findByStatus).
- Documented the `api_key` header.

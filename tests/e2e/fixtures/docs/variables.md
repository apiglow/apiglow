# Personalized guide

Send your first request against {{baseUrl}}, as tenant `{{tenant}}`.

## Calling as {{tenant}}

A resolved value is plain text, a hidden one is masked, and a name nothing
resolves asks to be defined: {{unknownVar}}.

```bash
curl -H 'X-Tenant: {{tenant}}' -H 'Authorization: Bearer {{token}}' {{baseUrl}}/pets
```

## Escaping

To name the reference instead of resolving it, put a backslash before it:
\\{{tenant}} in prose, `\{{tenant}}` in a code span.

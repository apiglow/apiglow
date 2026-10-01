import { declaredTypes } from '../schema-keywords.js'

// A `format` that cannot do anything where it is: one the declared type cannot
// carry (`date-time` on an integer, `int32` on a string — a format describes
// values of one type and is ignored on the others), or a known misspelling of
// a registered format (`datetime`, `date_time`, `e-mail`). Either way
// validators skip it and code generators fall back to the bare type: a date
// arrives as a plain string, an int32 as an unbounded number. This
// documentation shows the format as written next to the type.
//
// A format this list does not know is not a finding: the OpenAPI Format
// Registry is open, and custom formats are legitimate. One check per format
// that misfires, none otherwise.

const NUMERIC = ['number', 'integer']
const FORMAT_TYPES = {
  int8: NUMERIC,
  int16: NUMERIC,
  int32: NUMERIC,
  int64: NUMERIC,
  uint8: NUMERIC,
  uint16: NUMERIC,
  uint32: NUMERIC,
  uint64: NUMERIC,
  float: NUMERIC,
  double: NUMERIC,
  date: ['string'],
  'date-time': ['string'],
  time: ['string'],
  duration: ['string'],
  email: ['string'],
  'idn-email': ['string'],
  hostname: ['string'],
  'idn-hostname': ['string'],
  ipv4: ['string'],
  ipv6: ['string'],
  uri: ['string'],
  'uri-reference': ['string'],
  iri: ['string'],
  'iri-reference': ['string'],
  uuid: ['string'],
  'uri-template': ['string'],
  'json-pointer': ['string'],
  'relative-json-pointer': ['string'],
  regex: ['string'],
  byte: ['string'],
  binary: ['string'],
  base64url: ['string'],
  password: ['string'],
}

// Misspellings seen in real documents, each with the one format it means.
const MISSPELLINGS = {
  datetime: 'date-time',
  date_time: 'date-time',
  dateTime: 'date-time',
  DateTime: 'date-time',
  'date-Time': 'date-time',
  'Date-Time': 'date-time',
  timestamp_tz: 'date-time',
  'e-mail': 'email',
  'E-mail': 'email',
  Email: 'email',
  uuid4: 'uuid',
  UUID: 'uuid',
  ip4: 'ipv4',
  ip6: 'ipv6',
  'ip-v4': 'ipv4',
  'ip-v6': 'ipv6',
  URI: 'uri',
  'int-32': 'int32',
  'int-64': 'int64',
  Int32: 'int32',
  Int64: 'int64',
}

export const formatValid = {
  id: 'format-valid',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const { format } = schema
      if (typeof format !== 'string') continue
      const target = { op, location, dataPath: `${dataPath}/format` }
      const meant = MISSPELLINGS[format]
      if (meant) {
        check(false, { ...target, params: { format, expected: `format: ${meant}` } })
        continue
      }
      const carriers = FORMAT_TYPES[format]
      const types = declaredTypes(schema)?.filter((type) => type !== 'null')
      if (!carriers || !types?.length || types.some((type) => carriers.includes(type))) continue
      check(false, { ...target, params: { format, expected: `type: ${carriers[0]}` } })
    }
  },
}

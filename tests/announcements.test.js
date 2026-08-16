import { describe, expect, it } from 'vitest'
import {
  announcementKey,
  manifestAnnouncements,
  normalizeAnnouncements,
  rememberDismissed,
  visibleAnnouncements,
} from '../src/announcements.js'

const AUGUST = Date.parse('2026-08-16T12:00:00Z')

const entry = (raw) => normalizeAnnouncements([raw])[0]

describe('normalizeAnnouncements', () => {
  it('fills the defaults a bare entry leaves out', () => {
    expect(entry({ text: 'Sunday maintenance' })).toEqual({
      id: null,
      text: 'Sunday maintenance',
      level: 'info',
      dismissible: true,
      startsAt: null,
      endsAt: null,
    })
  })

  it('keeps the text in its declared form, per-language map included', () => {
    const map = { en: 'Maintenance', fr: 'Maintenance planifiée' }
    expect(entry({ text: map }).text).toEqual(map)
  })

  it('drops an entry with no readable text', () => {
    const warnings = []
    expect(normalizeAnnouncements([{ level: 'warning' }, { text: '  ' }], warnings)).toEqual([])
    expect(warnings).toHaveLength(2)
  })

  it('accepts a map whose only language is not English', () => {
    expect(entry({ text: { fr: 'Coupure prévue' } })).not.toBeUndefined()
  })

  it('falls back to info on an unknown level, and says so', () => {
    const warnings = []
    expect(normalizeAnnouncements([{ text: 'x', level: 'critical' }], warnings)[0].level).toBe(
      'info',
    )
    expect(warnings[0]).toMatch(/unknown level/)
  })

  it('reads the schedule as instants', () => {
    const scheduled = entry({
      text: 'x',
      startsAt: '2026-08-20T00:00:00Z',
      endsAt: '2026-08-21T06:00:00Z',
    })
    expect(scheduled.startsAt).toBe(Date.parse('2026-08-20T00:00:00Z'))
    expect(scheduled.endsAt).toBe(Date.parse('2026-08-21T06:00:00Z'))
  })

  it('widens the window rather than hiding a notice on an unreadable date', () => {
    const warnings = []
    const bad = normalizeAnnouncements([{ text: 'x', startsAt: 'next tuesday' }], warnings)[0]
    expect(bad.startsAt).toBeNull()
    expect(warnings[0]).toMatch(/unreadable startsAt/)
  })

  it('flags a window that can never open', () => {
    const warnings = []
    normalizeAnnouncements(
      [{ text: 'x', startsAt: '2026-08-21T00:00:00Z', endsAt: '2026-08-20T00:00:00Z' }],
      warnings,
    )
    expect(warnings[0]).toMatch(/can never show/)
  })

  it('flags two entries sharing one id, and keeps both', () => {
    const warnings = []
    const out = normalizeAnnouncements(
      [
        { id: 'news', text: 'first' },
        { id: 'news', text: 'second' },
      ],
      warnings,
    )
    expect(out).toHaveLength(2)
    expect(warnings[0]).toMatch(/duplicate id/)
  })

  it('takes only `dismissible: false` as a refusal', () => {
    expect(entry({ text: 'x', dismissible: false }).dismissible).toBe(false)
    expect(entry({ text: 'x', dismissible: 'no' }).dismissible).toBe(true)
  })

  it('ignores anything that is not a list of objects', () => {
    expect(normalizeAnnouncements(undefined)).toEqual([])
    expect(normalizeAnnouncements('/news.json')).toEqual([])
    expect(normalizeAnnouncements(['news'])).toEqual([])
  })
})

describe('manifestAnnouncements', () => {
  it('unwraps the envelope', () => {
    expect(manifestAnnouncements({ announcements: [{ text: 'x' }] })).toEqual([{ text: 'x' }])
  })

  it('refuses a file written against another shape', () => {
    expect(() => manifestAnnouncements([{ text: 'x' }])).toThrow(/announcements/)
    expect(() => manifestAnnouncements({ pages: [] })).toThrow(/announcements/)
  })
})

describe('announcementKey', () => {
  it('is the declared id when there is one', () => {
    expect(announcementKey(entry({ id: 'v2-launch', text: 'v2 is out' }))).toBe('v2-launch')
  })

  it('follows the text when there is not', () => {
    const before = announcementKey(entry({ text: 'v2 is out' }))
    expect(before).toBe(announcementKey(entry({ text: 'v2 is out' })))
    expect(before).not.toBe(announcementKey(entry({ text: 'v2 is out!' })))
  })

  it('is the same key in every language', () => {
    const map = { en: 'Maintenance', fr: 'Maintenance planifiée' }
    const key = announcementKey(entry({ text: map }))
    // A key built from the sentence the reader saw would equal one of these.
    expect(key).not.toBe(announcementKey(entry({ text: map.en })))
    expect(key).not.toBe(announcementKey(entry({ text: map.fr })))
  })

  it('cannot be collided with by an author id', () => {
    expect(announcementKey(entry({ text: 'x' }))).toMatch(/^~/)
  })
})

describe('visibleAnnouncements', () => {
  const shown = (raw, options) =>
    visibleAnnouncements(normalizeAnnouncements(raw), { now: AUGUST, ...options }).map(
      (item) => item.text,
    )

  it('holds an entry back until its window opens', () => {
    expect(shown([{ text: 'later', startsAt: '2026-09-01T00:00:00Z' }])).toEqual([])
    expect(shown([{ text: 'now', startsAt: '2026-08-01T00:00:00Z' }])).toEqual(['now'])
  })

  it('retires an entry once its window closes', () => {
    expect(shown([{ text: 'over', endsAt: '2026-08-16T11:00:00Z' }])).toEqual([])
    expect(shown([{ text: 'live', endsAt: '2026-08-16T13:00:00Z' }])).toEqual(['live'])
  })

  it('leaves out what the reader has closed', () => {
    const entries = [{ id: 'news', text: 'closed' }, { text: 'open' }]
    expect(shown(entries, { dismissed: ['news'] })).toEqual(['open'])
  })

  it('shows a pinned entry again even to a reader who closed it', () => {
    const entries = [{ id: 'outage', text: 'pinned', dismissible: false }]
    expect(shown(entries, { dismissed: ['outage'] })).toEqual(['pinned'])
  })
})

describe('rememberDismissed', () => {
  it('adds a key without duplicating it', () => {
    expect(rememberDismissed(['a'], 'b')).toEqual(['a', 'b'])
    expect(rememberDismissed(['a', 'b'], 'a')).toEqual(['b', 'a'])
  })

  it('survives a storage slot holding something else', () => {
    expect(rememberDismissed(null, 'a')).toEqual(['a'])
    expect(rememberDismissed('a', 'b')).toEqual(['b'])
  })

  it('drops the oldest past the cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => `k${i}`)
    const out = rememberDismissed(many, 'new')
    expect(out).toHaveLength(50)
    expect(out[0]).toBe('k1')
    expect(out.at(-1)).toBe('new')
  })
})

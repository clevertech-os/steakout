import { describe, expect, it } from 'vitest'
import {
  buildProfilePageMeta,
  escapeHtml,
  injectProfileMeta,
} from '../../../server/src/profileMeta.js'

describe('buildProfilePageMeta', () => {
  it('builds title + description from displayed fields only', () => {
    const meta = buildProfilePageMeta({
      name: 'Example Pool',
      address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      officialScore: 98.5,
      observationStatus: 'on-schedule',
      historyDepthDays: 30.4,
      found: true,
    })
    expect(meta.title).toBe('Example Pool · Steakout')
    expect(meta.description).toContain('Observation: On schedule.')
    expect(meta.description).toContain('Official Nimiq Validator Trust Score: 98.5')
    expect(meta.description).toContain('Indexed history depth: 30 days.')
    expect(meta.description).not.toMatch(/APY|best|guaranteed|fraud/i)
  })

  it('uses short address when name is missing', () => {
    const meta = buildProfilePageMeta({
      name: null,
      address: 'NQ0700000000000000000000000000000000',
      officialScore: null,
      observationStatus: 'insufficient-data',
      historyDepthDays: 0,
      found: true,
    })
    expect(meta.title).toMatch(/^NQ07…0000 · Steakout$/)
    expect(meta.description).toContain('Not enough observed data')
    expect(meta.description).toContain('Unavailable')
    expect(meta.description).toContain('insufficient data')
  })

  it('graceful text for unknown/unlisted validators', () => {
    const meta = buildProfilePageMeta({
      name: null,
      address: 'not-an-address',
      officialScore: null,
      observationStatus: 'insufficient-data',
      historyDepthDays: 0,
      found: false,
    })
    expect(meta.title).toBe('Validator profile · Steakout')
    expect(meta.description).toMatch(/No registry record|not valid/i)
  })
})

describe('escapeHtml + injectProfileMeta', () => {
  it('escapes attribute-breaking characters', () => {
    expect(escapeHtml(`a<"&'>`)).toBe('a&lt;&quot;&amp;&#39;&gt;')
  })

  it('injects title and social meta into SPA shell HTML', () => {
    const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Steakout</title>
    <meta name="description" content="default" />
    <meta property="og:title" content="Steakout" />
  </head>
  <body><div id="root"></div></body>
</html>`

    const out = injectProfileMeta(
      shell,
      {
        title: 'Pool · Steakout',
        description: 'Observation: On schedule.',
      },
      { canonicalUrl: 'https://example.test/validators/NQ07' },
    )

    expect(out).toContain('<title>Pool · Steakout</title>')
    expect(out).toContain('name="description" content="Observation: On schedule."')
    expect(out).toContain('property="og:title" content="Pool · Steakout"')
    expect(out).toContain('property="og:description" content="Observation: On schedule."')
    expect(out).toContain('name="twitter:title" content="Pool · Steakout"')
    expect(out).toContain('property="og:url" content="https://example.test/validators/NQ07"')
    expect(out).toContain('rel="canonical" href="https://example.test/validators/NQ07"')
    // Original description/og:title should not remain as stale defaults.
    expect(out.match(/name="description"/g)?.length).toBe(1)
    expect(out.match(/property="og:title"/g)?.length).toBe(1)
  })

  it('escapes injected meta content', () => {
    const shell = '<html><head><title>X</title></head><body></body></html>'
    const out = injectProfileMeta(shell, {
      title: 'A <script> · Steakout',
      description: 'status "quoted"',
    })
    expect(out).toContain('<title>A &lt;script&gt; · Steakout</title>')
    expect(out).toContain('content="status &quot;quoted&quot;"')
    expect(out).not.toContain('<script>')
  })
})

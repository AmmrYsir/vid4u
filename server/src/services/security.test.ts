import { describe, expect, it } from 'vitest'
import {
  assertAllowedUrl,
  contentDisposition,
  platformForUrl,
  safeFilename,
  signDownloadToken,
  verifyDownloadToken,
} from './security.js'

const allowed = ['facebook.com', 'fb.watch', 'youtube.com', 'youtu.be', 'instagram.com']

describe('assertAllowedUrl', () => {
  it('accepts a real platform host and strips tracking parameters', () => {
    const url = assertAllowedUrl(
      'https://www.facebook.com/reel/123?fbclid=abc&utm_source=x&keep=1#fragment',
      allowed,
    )
    expect(url.hostname).toBe('www.facebook.com')
    expect(url.searchParams.get('fbclid')).toBeNull()
    expect(url.searchParams.get('utm_source')).toBeNull()
    expect(url.searchParams.get('keep')).toBe('1')
    expect(url.hash).toBe('')
  })

  it('strips YouTube share tracking', () => {
    const url = assertAllowedUrl('https://youtu.be/abc?si=tracking&t=10', allowed)
    expect(url.searchParams.get('si')).toBeNull()
    expect(url.searchParams.get('t')).toBe('10')
  })

  it('rejects lookalike domains', () => {
    expect(() => assertAllowedUrl('https://notfacebook.com/reel/1', allowed)).toThrowError(
      /not supported/i,
    )
    expect(() => assertAllowedUrl('https://facebook.com.evil.example/1', allowed)).toThrowError(
      /not supported/i,
    )
  })

  it('rejects local, IP and credential URLs', () => {
    expect(() => assertAllowedUrl('http://127.0.0.1/video', allowed)).toThrowError(/not allowed/i)
    expect(() => assertAllowedUrl('http://localhost/video', allowed)).toThrowError(/not allowed/i)
    expect(() =>
      assertAllowedUrl('https://user:pass@facebook.com/reel/1', allowed),
    ).toThrowError(/credentials/i)
  })

  it('rejects bad protocols and custom ports', () => {
    expect(() => assertAllowedUrl('ftp://facebook.com/reel/1', allowed)).toThrowError(
      /http and https/i,
    )
    expect(() => assertAllowedUrl('https://facebook.com:8443/reel/1', allowed)).toThrowError(
      /custom ports/i,
    )
  })

  it('rejects empty and invalid values', () => {
    expect(() => assertAllowedUrl('', allowed)).toThrowError(/valid video URL/i)
    expect(() => assertAllowedUrl('not a url', allowed)).toThrowError(/valid video URL/i)
  })
})

describe('download tokens', () => {
  const payload = {
    url: 'https://www.facebook.com/reel/123',
    title: 'A test video',
    mediaId: '123',
  }

  it('round-trips a signed token', () => {
    const signed = signDownloadToken(payload, 'secret', 60_000)
    const decoded = verifyDownloadToken(signed.token, 'secret')
    expect(decoded.u).toBe(payload.url)
    expect(decoded.t).toBe(payload.title)
    expect(decoded.i).toBe(payload.mediaId)
    expect(decoded.e).toBeGreaterThan(Date.now())
  })

  it('rejects a token signed with a different secret', () => {
    const signed = signDownloadToken(payload, 'secret', 60_000)
    expect(() => verifyDownloadToken(signed.token, 'other-secret')).toThrowError(/expired|invalid/i)
  })

  it('rejects tampered payloads', () => {
    const signed = signDownloadToken(payload, 'secret', 60_000)
    const [body, signature] = signed.token.split('.')
    const tampered = Buffer.from(
      JSON.stringify({ u: 'https://evil.example/video', t: 'x', i: '1', e: Date.now() + 60_000 }),
    ).toString('base64url')
    expect(() => verifyDownloadToken(`${tampered}.${signature}`, 'secret')).toThrowError(
      /expired|invalid/i,
    )
    expect(body.length).toBeGreaterThan(0)
  })

  it('rejects expired tokens', () => {
    const signed = signDownloadToken(payload, 'secret', -1_000)
    expect(() => verifyDownloadToken(signed.token, 'secret')).toThrowError(/expired|invalid/i)
  })
})

describe('filenames', () => {
  it('sanitises unsafe characters and keeps a safe extension', () => {
    const filename = safeFilename('A/B:C*D? "E"', '42', 'mp4')
    expect(filename).toBe('A B C D E [42].mp4')
  })

  it('always ends with an allowed extension', () => {
    expect(safeFilename('title', '1', 'mp3')).toMatch(/\.mp3$/)
    expect(safeFilename('title', '1', 'webm')).toMatch(/\.webm$/)
  })

  it('produces an RFC 5987 content disposition', () => {
    const header = contentDisposition('Vidéo [1].mp4')
    expect(header).toContain('attachment;')
    expect(header).toContain("filename*=UTF-8''")
  })
})

describe('platformForUrl', () => {
  it('maps known hosts and falls back to video', () => {
    expect(platformForUrl(new URL('https://www.instagram.com/reel/1')).id).toBe('instagram')
    expect(platformForUrl(new URL('https://example.com/video')).label).toBe('Video')
  })
})

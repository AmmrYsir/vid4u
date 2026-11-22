import { describe, expect, it } from 'vitest'
import {
  detectPlatform,
  formatBytes,
  formatDuration,
  minutesUntil,
} from './platforms'

describe('detectPlatform', () => {
  it('detects supported hosts and subdomains', () => {
    expect(detectPlatform('https://www.facebook.com/reel/123')?.label).toBe('Facebook')
    expect(detectPlatform('https://fb.watch/abc')?.label).toBe('Facebook')
    expect(detectPlatform('https://www.instagram.com/reel/abc')?.label).toBe('Instagram')
    expect(detectPlatform('https://youtu.be/abc')?.label).toBe('YouTube')
  })

  it('rejects lookalikes and unsafe protocols', () => {
    expect(detectPlatform('https://instagram.com.evil.example/reel/1')).toBeNull()
    expect(detectPlatform('https://notfacebook.com/reel/1')).toBeNull()
    expect(detectPlatform('javascript:alert(1)')).toBeNull()
    expect(detectPlatform('not a url')).toBeNull()
  })
})

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(63)).toBe('1:03')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(undefined)).toBe('')
  })

  it('formats file sizes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatBytes(undefined)).toBe('')
  })

  it('computes remaining minutes', () => {
    expect(minutesUntil(new Date(Date.now() + 90_000).toISOString())).toBe(2)
    expect(minutesUntil(new Date(Date.now() - 1000).toISOString())).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { mapYtDlpError } from './ytdlp.js'
import type { YtInfo } from './presets.js'
import { buildPresets, pickThumbnail, resolvePreset } from './presets.js'

const facebookInfo: YtInfo = {
  id: '1136294041346082',
  title: 'Facebook test',
  formats: [
    { format_id: 'sd', ext: 'mp4' },
    { format_id: 'hd', ext: 'mp4' },
  ],
  url: 'https://video.example/test.mp4',
  ext: 'mp4',
}

const youtubeInfo: YtInfo = {
  id: 'abc',
  title: 'YouTube test',
  formats: [
    { format_id: '137', height: 1080, vcodec: 'avc1.640028', acodec: 'none', ext: 'mp4', filesize: 10_000_000 },
    { format_id: '136', height: 720, vcodec: 'avc1.4d401f', acodec: 'none', ext: 'mp4', filesize: 5_000_000 },
    { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', abr: 128, filesize: 1_000_000 },
  ],
}

describe('buildPresets', () => {
  it('keeps Facebook hd/sd formats that have no numeric height', () => {
    const presets = buildPresets(facebookInfo)
    expect(presets.map((preset) => preset.id)).toEqual([
      'video:best',
      'video:hd',
      'video:sd',
      'audio:mp3',
    ])
  })

  it('derives quality presets from real format heights', () => {
    const presets = buildPresets(youtubeInfo)
    expect(presets.map((preset) => preset.id)).toEqual([
      'video:best',
      'video:1080',
      'video:720',
      'audio:mp3',
    ])
    expect(presets.find((preset) => preset.id === 'video:1080')?.sizeBytes).toBe(11_000_000)
  })

  it('does not invent a video preset for an audio-only post', () => {
    const presets = buildPresets({
      formats: [{ format_id: 'audio', vcodec: 'none', acodec: 'mp4a', ext: 'm4a' }],
      url: 'https://example/audio.m4a',
    })
    expect(presets.map((preset) => preset.id)).toEqual(['audio:mp3'])
  })

  it('labels portrait video by width and height', () => {
    const presets = buildPresets({
      formats: [
        { format_id: 'v', height: 1280, width: 720, vcodec: 'avc1', acodec: 'none', ext: 'mp4' },
      ],
    })
    expect(presets.find((preset) => preset.id === 'video:1280')?.label).toBe('MP4 · 720×1280')
  })

  it('caps the number of quality choices', () => {
    const presets = buildPresets({
      formats: [2160, 1440, 1080, 720, 480, 360, 240, 144].map((height) => ({
        format_id: String(height),
        height,
        vcodec: 'avc1',
        acodec: 'none',
        ext: 'mp4',
      })),
    })
    expect(presets.filter((preset) => preset.height).length).toBe(6)
  })
})

describe('resolvePreset', () => {
  it('builds a bounded selector for a quality preset', () => {
    const selection = resolvePreset('video:720')
    expect(selection.audioOnly).toBe(false)
    expect(selection.formatSelector).toContain('height<=720')
    expect(selection.formatSelector).toContain('avc1')
  })

  it('prefers H.264 for best available', () => {
    expect(resolvePreset('video:best').formatSelector).toContain('vcodec^=avc1')
  })

  it('handles Facebook hd/sd', () => {
    expect(resolvePreset('video:hd').formatSelector).toBe('hd/b')
    expect(resolvePreset('video:sd').formatSelector).toBe('sd/b')
  })

  it('rejects unknown presets', () => {
    expect(() => resolvePreset('video:9999')).toThrowError(/quality is not available/i)
    expect(() => resolvePreset('../../etc/passwd')).toThrowError(/quality is not available/i)
  })

  it('supports audio extraction', () => {
    expect(resolvePreset('audio:mp3')).toMatchObject({ audioOnly: true, ext: 'mp3' })
  })
})

describe('pickThumbnail', () => {
  it('prefers the highest-ranked thumbnail', () => {
    expect(
      pickThumbnail({
        thumbnails: [
          { url: 'https://img/low.jpg', preference: -5, width: 320 },
          { url: 'https://img/high.jpg', preference: 10, width: 1280 },
        ],
      }),
    ).toBe('https://img/high.jpg')
  })
})

describe('mapYtDlpError', () => {
  it('does not mistake a missing format for a private video', () => {
    expect(mapYtDlpError('ERROR: Requested format is not available').code).toBe(
      'format_unavailable',
    )
  })

  it('maps common platform failures', () => {
    expect(mapYtDlpError('ERROR: Private video').code).toBe('private')
    expect(mapYtDlpError('ERROR: Sign in to confirm you are not a bot').code).toBe(
      'login_required',
    )
    expect(mapYtDlpError('ERROR: This live event will begin in 2 hours').code).toBe(
      'live_unsupported',
    )
  })
})

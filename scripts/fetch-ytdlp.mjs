#!/usr/bin/env node
/**
 * Downloads the pinned yt-dlp standalone binary into server/bin and verifies
 * it against the release SHA2-256SUMS file.
 *
 * Usage:
 *   node scripts/fetch-ytdlp.mjs            # install the pinned version
 *   node scripts/fetch-ytdlp.mjs --force    # reinstall the pinned version
 *   node scripts/fetch-ytdlp.mjs --latest   # resolve and install the latest release
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PINNED_VERSION = '2026.10.26'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = join(ROOT, 'server', 'bin')

const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const latest = args.has('--latest')

const assetForPlatform = () => {
  const { platform, arch } = process
  if (platform === 'win32') {
    return arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe'
  }
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (platform === 'linux') {
    return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
  }
  throw new Error(`Unsupported platform for yt-dlp: ${platform}/${arch}`)
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'vid4u-setup/1.0' },
    signal: AbortSignal.timeout(120_000),
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'vid4u-setup/1.0' },
    signal: AbortSignal.timeout(300_000),
    redirect: 'follow',
  })
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  await writeFile(destination, bytes)
  return bytes
}

async function resolveVersion() {
  if (!latest) return PINNED_VERSION
  const body = await fetchText('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
  const release = JSON.parse(body)
  if (typeof release.tag_name !== 'string') {
    throw new Error('Could not read the latest yt-dlp tag from GitHub.')
  }
  return release.tag_name
}

async function main() {
  const version = await resolveVersion()
  const asset = assetForPlatform()
  const output = join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

  if (!force && !latest) {
    try {
      const existing = await readFile(output)
      if (existing.byteLength > 1_000_000) {
        console.log(`yt-dlp already present at ${output}`)
        console.log('Run with --force to reinstall, or --latest to update.')
        return
      }
    } catch {
      // Not installed yet.
    }
  }

  await mkdir(BIN_DIR, { recursive: true })

  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`
  console.log(`Downloading yt-dlp ${version} (${asset})…`)

  const checksums = await fetchText(`${base}/SHA2-256SUMS`)
  const checksumLine = checksums
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(` ${asset}`) || line.trim().endsWith(`\t${asset}`))
  if (!checksumLine) {
    throw new Error(`No SHA-256 checksum published for ${asset} in ${version}.`)
  }
  const expected = checksumLine.trim().split(/\s+/)[0].toLowerCase()

  const temp = `${output}.download`
  try {
    const bytes = await download(`${base}/${asset}`, temp)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`)
    }
    await rename(temp, output)
    if (process.platform !== 'win32') await chmod(output, 0o755)
    console.log(`Installed ${output} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB).`)
  } finally {
    await rm(temp, { force: true })
  }
}

main().catch((error) => {
  console.error(`yt-dlp setup failed: ${error instanceof Error ? error.message : String(error)}`)
  console.error('You can also install yt-dlp manually and set YTDLP_PATH in .env.')
  process.exit(1)
})

import { spawn } from 'node:child_process'

/**
 * Kill a yt-dlp process and any children it spawned (FFmpeg).
 * On Unix the child is started detached so the whole process group can be killed.
 */
export function killProcessTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => {
      // The process may already be gone.
    })
    return
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process may already be gone.
    }
  }
}

/**
 * @fileoverview Terminal paste desteği — metin ve görüntü yapıştırma.
 * Linux: xclip/wl-paste, macOS: pbpaste/osascript, Windows: PowerShell
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

export const PASTE_THRESHOLD = 800; // Bu kadar karakterden uzun metin "büyük paste"

type Platform = 'linux' | 'darwin' | 'win32';

function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'darwin') return 'darwin';
  if (p === 'win32') return 'win32';
  return 'linux';
}

/**
 * Panodaki metni al.
 */
export async function getClipboardText(): Promise<string | null> {
  const platform = getPlatform();
  try {
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('pbpaste', [], { timeout: 3000 });
      return stdout || null;
    }
    if (platform === 'linux') {
      // Wayland önce dene, sonra X11
      try {
        const { stdout } = await execFileAsync('wl-paste', ['--no-newline'], { timeout: 2000 });
        if (stdout) return stdout;
      } catch { /* X11'e geç */ }
      try {
        const { stdout } = await execFileAsync('xclip', ['-selection', 'clipboard', '-o'], { timeout: 2000 });
        return stdout || null;
      } catch { /* xsel dene */ }
      try {
        const { stdout } = await execFileAsync('xsel', ['--clipboard', '--output'], { timeout: 2000 });
        return stdout || null;
      } catch { return null; }
    }
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { timeout: 3000 });
      return stdout || null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Panoda görüntü var mı kontrol et.
 */
export async function hasImageInClipboard(): Promise<boolean> {
  const platform = getPlatform();
  try {
    if (platform === 'linux') {
      try {
        const { stdout } = await execFileAsync('wl-paste', ['-l'], { timeout: 2000 });
        return /image\/(png|jpeg|jpg|gif|webp|bmp)/.test(stdout);
      } catch { /* X11 */ }
      try {
        const { stdout } = await execFileAsync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], { timeout: 2000 });
        return /image\/(png|jpeg|jpg|gif|webp|bmp)/.test(stdout);
      } catch { return false; }
    }
    if (platform === 'darwin') {
      const result = await execFileAsync('osascript', ['-e', 'the clipboard as «class PNGf»'], { timeout: 3000 }).catch(() => null);
      return result !== null;
    }
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', '(Get-Clipboard -Format Image) -ne $null'], { timeout: 3000 });
      return stdout.trim().toLowerCase() === 'true';
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Panodan görüntüyü base64 olarak al.
 */
export async function getImageFromClipboard(): Promise<{ base64: string; mediaType: string } | null> {
  const platform = getPlatform();
  const tmpPath = join(tmpdir(), `seth_paste_${Date.now()}.png`);

  try {
    if (platform === 'linux') {
      try {
        await execFileAsync('wl-paste', ['--type', 'image/png', '--output', tmpPath], { timeout: 3000 });
      } catch {
        try {
          await execFileAsync('sh', ['-c', `xclip -selection clipboard -t image/png -o > "${tmpPath}"`], { timeout: 3000 });
        } catch { return null; }
      }
    } else if (platform === 'darwin') {
      await execFileAsync('osascript', [
        '-e', 'set png_data to (the clipboard as «class PNGf»)',
        '-e', `set fp to open for access POSIX file "${tmpPath}" with write permission`,
        '-e', 'write png_data to fp',
        '-e', 'close access fp',
      ], { timeout: 5000 });
    } else if (platform === 'win32') {
      await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${tmpPath}', [System.Drawing.Imaging.ImageFormat]::Png) }`,
      ], { timeout: 5000 });
    } else {
      return null;
    }

    const { readFile } = await import('fs/promises');
    const buf = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});
    return { base64: buf.toString('base64'), mediaType: 'image/png' };
  } catch {
    await unlink(tmpPath).catch(() => {});
    return null;
  }
}

/**
 * Büyük metin paste'ini formatla — AI'ya gönderilecek şekilde.
 */
export function formatLargePaste(text: string, index: number): string {
  const lines = text.split('\n').length;
  return `[Yapıştırılan metin #${index} — ${lines} satır]\n${text}`;
}

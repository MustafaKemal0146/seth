/**
 * @fileoverview Dosya yolu kırpma — uzun yolları ortadan kırpar.
 * Örnek: "src/components/deeply/nested/MyComponent.tsx" → "src/…/MyComponent.tsx"
 */

/**
 * Uzun dosya yolunu ortadan kırp, başını ve sonunu koru.
 */
export function truncatePathMiddle(filePath: string, maxLength = 50): string {
  if (filePath.length <= maxLength) return filePath;

  const sep = filePath.includes('/') ? '/' : '\\';
  const parts = filePath.split(sep);
  const filename = parts[parts.length - 1] ?? '';

  // Sadece dosya adı bile uzunsa baştan kes
  if (filename.length >= maxLength - 4) {
    return '…' + filename.slice(-(maxLength - 1));
  }

  // Baştan ne kadar alabiliriz?
  const available = maxLength - filename.length - 4; // 4 = "/…/"
  let prefix = '';
  for (const part of parts.slice(0, -1)) {
    if (prefix.length + part.length + 1 <= available) {
      prefix += (prefix ? sep : '') + part;
    } else {
      break;
    }
  }

  return `${prefix}${sep}…${sep}${filename}`;
}

/**
 * Araç sonucu çıktısını boyut sınırına göre kırp.
 */
export function truncateToolOutput(output: string, maxChars = 20_000): string {
  if (output.length <= maxChars) return output;
  const half = Math.floor(maxChars / 2);
  return output.slice(0, half) + `\n\n… [${output.length - maxChars} karakter kırpıldı] …\n\n` + output.slice(-half);
}

/**
 * @fileoverview Dosya yolu kırpma — uzun yolları ortadan kırpar.
 * Örnek: "src/components/deeply/nested/MyComponent.tsx" → "src/…/MyComponent.tsx"
 */

/**
 * Uzun dosya yolunu ortadan kırp, başını ve sonunu koru.
 *
 * @param filePath The file path to truncate.
 * @param maxLength Maximum length of the result.
 * @returns Truncated path.
 */
export function truncatePathMiddle(filePath: string, maxLength = 50): string {
  if (filePath.length <= maxLength) return filePath;
  if (maxLength <= 0) return '';
  if (maxLength === 1) return '…';

  const sep = filePath.includes('/') ? '/' : '\\';
  const parts = filePath.split(sep);
  const filename = parts[parts.length - 1] ?? '';

  // Sadece dosya adı bile uzunsa baştan kes
  if (filename.length >= maxLength - 2) {
    return '…' + filename.slice(-(maxLength - 1));
  }

  // Baştan ne kadar alabiliriz?
  // prefix + sep + '…' + sep + filename
  const available = maxLength - filename.length - 3; // 3 = sep + '…' + sep
  if (available < 0) {
    // filename is still too long to have a prefix, but didn't trigger the above condition
    return '…' + filename.slice(-(maxLength - 1));
  }

  let prefix = '';
  const prefixParts = parts.slice(0, -1);
  for (let i = 0; i < prefixParts.length; i++) {
    const part = prefixParts[i];
    const nextPrefix = prefix + (prefix ? sep : '') + part;
    if (nextPrefix.length <= available) {
      prefix = nextPrefix;
    } else {
      break;
    }
  }

  if (!prefix) {
    return '…' + sep + filename;
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

/**
 * Semver karşılaştırma — "1.10.0 > 1.9.0" gibi doğru karşılaştırma.
 */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0, nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return true; // equal
}

export function semverGt(a: string, b: string): boolean {
  return semverGte(a, b) && a !== b;
}

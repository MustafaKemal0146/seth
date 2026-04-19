/**
 * @fileoverview Oturum bağlamı: görev listesi ve kayıtlı araç özeti (todo / arac_ara).
 */

export type TodoDurum = 'bekliyor' | 'suruyor' | 'tamamlandi';

export interface GorevOgesi {
  readonly id: string;
  readonly baslik: string;
  readonly durum: TodoDurum;
}

let activeSessionId = 'varsayilan';

export function setAgentSessionContext(sessionId: string): void {
  activeSessionId = sessionId;
}

export function getAgentSessionContext(): string {
  return activeSessionId;
}

const todosBySession = new Map<string, GorevOgesi[]>();

export function todoListesiniAyarla(sessionId: string, gorevler: GorevOgesi[]): void {
  todosBySession.set(sessionId, [...gorevler]);
}

export function todoListesiniOku(sessionId: string): GorevOgesi[] {
  return todosBySession.get(sessionId) ?? [];
}

export function gorevEkle(sessionId: string, gorev: GorevOgesi): void {
  const cur = todoListesiniOku(sessionId);
  if (cur.some(g => g.id === gorev.id)) {
    throw new Error(`Görev id zaten var: ${gorev.id}`);
  }
  todoListesiniAyarla(sessionId, [...cur, gorev]);
}

export function gorevGuncelle(
  sessionId: string,
  id: string,
  patch: Partial<Pick<GorevOgesi, 'baslik' | 'durum'>>,
): boolean {
  const cur = todoListesiniOku(sessionId);
  const idx = cur.findIndex(g => g.id === id);
  if (idx < 0) return false;
  const next = [...cur];
  const o = next[idx]!;
  next[idx] = { ...o, ...patch };
  todoListesiniAyarla(sessionId, next);
  return true;
}

export interface AracOzeti {
  readonly name: string;
  readonly description: string;
}

let aracOzeti: AracOzeti[] = [];

export function kayitliAraclariKaydet(ozet: AracOzeti[]): void {
  aracOzeti = [...ozet];
}

export function kayitliAraclariOku(): readonly AracOzeti[] {
  return aracOzeti;
}

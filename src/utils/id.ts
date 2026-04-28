import { randomBytes } from 'node:crypto';

export function generateId(prefix?: string): string {
  const id = `${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * @fileoverview Basit cron/zamanlama sistemi — periyodik görevler.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CRON_FILE = join(homedir(), '.seth', 'cron.json');

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  intervalMs: number;
  lastRun?: number;
  enabled: boolean;
  createdAt: string;
}

function loadJobs(): CronJob[] {
  if (!existsSync(CRON_FILE)) return [];
  try { return JSON.parse(readFileSync(CRON_FILE, 'utf-8')) as CronJob[]; } catch { return []; }
}

function saveJobs(jobs: CronJob[]): void {
  const dir = join(homedir(), '.seth');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

export function addCronJob(name: string, prompt: string, intervalMs: number): CronJob {
  const jobs = loadJobs();
  const job: CronJob = {
    id: `cron_${Date.now()}`,
    name,
    prompt,
    intervalMs,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  saveJobs(jobs);
  return job;
}

export function listCronJobs(): CronJob[] {
  return loadJobs();
}

export function removeCronJob(id: string): boolean {
  const jobs = loadJobs();
  const filtered = jobs.filter(j => j.id !== id);
  if (filtered.length === jobs.length) return false;
  saveJobs(filtered);
  return true;
}

export function toggleCronJob(id: string, enabled: boolean): boolean {
  const jobs = loadJobs();
  const job = jobs.find(j => j.id === id);
  if (!job) return false;
  job.enabled = enabled;
  saveJobs(jobs);
  return true;
}

/**
 * Çalışması gereken görevleri döndür ve lastRun güncelle.
 */
export function getDueJobs(): CronJob[] {
  const jobs = loadJobs();
  const now = Date.now();
  const due: CronJob[] = [];

  for (const job of jobs) {
    if (!job.enabled) continue;
    const lastRun = job.lastRun ?? 0;
    if (now - lastRun >= job.intervalMs) {
      job.lastRun = now;
      due.push(job);
    }
  }

  if (due.length > 0) saveJobs(jobs);
  return due;
}

/** İnsan okunabilir interval formatı */
export function parseIntervalStr(s: string): number | null {
  const m = s.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]!);
  const unit = m[2]!.toLowerCase();
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[unit] ?? 0);
}

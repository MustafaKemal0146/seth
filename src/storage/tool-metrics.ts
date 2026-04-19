/**
 * @fileoverview Tool telemetry metrics — JSONL events + aggregate summary.
 */

import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

interface ToolMetricEvent {
  timestamp: string;
  toolName: string;
  durationMs: number;
  isError: boolean;
  isTimeout: boolean;
}

interface MetricBucket {
  calls: number;
  errors: number;
  timeouts: number;
  totalDurationMs: number;
  avgDurationMs: number;
  errorRate: number;
  timeoutRate: number;
}

interface ToolMetricsSummary {
  updatedAt: string;
  totals: MetricBucket;
  tools: Record<string, MetricBucket>;
}

const METRICS_DIR = join(homedir(), '.seth', 'metrics');
const EVENTS_FILE = join(METRICS_DIR, 'tool-events.jsonl');
const SUMMARY_FILE = join(METRICS_DIR, 'tool-metrics-summary.json');
let pendingSummaryEvents: ToolMetricEvent[] = [];
let summaryFlushInFlight: Promise<void> | null = null;

function makeBucket(): MetricBucket {
  return {
    calls: 0,
    errors: 0,
    timeouts: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    errorRate: 0,
    timeoutRate: 0,
  };
}

function updateBucket(bucket: MetricBucket, event: ToolMetricEvent): MetricBucket {
  const calls = bucket.calls + 1;
  const errors = bucket.errors + (event.isError ? 1 : 0);
  const timeouts = bucket.timeouts + (event.isTimeout ? 1 : 0);
  const totalDurationMs = bucket.totalDurationMs + Math.max(0, event.durationMs);
  return {
    calls,
    errors,
    timeouts,
    totalDurationMs,
    avgDurationMs: Number((totalDurationMs / calls).toFixed(2)),
    errorRate: Number((errors / calls).toFixed(4)),
    timeoutRate: Number((timeouts / calls).toFixed(4)),
  };
}

export async function logToolMetric(event: ToolMetricEvent): Promise<void> {
  try {
    await mkdir(METRICS_DIR, { recursive: true });
    await appendFile(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf8');
    pendingSummaryEvents.push(event);
    scheduleSummaryFlush();
  } catch {
    // telemetry should never break the tool path
  }
}

function scheduleSummaryFlush(): void {
  if (summaryFlushInFlight) return;
  summaryFlushInFlight = flushSummaryEvents()
    .catch(() => {
      // ignore summary write errors
    })
    .finally(() => {
      summaryFlushInFlight = null;
      if (pendingSummaryEvents.length > 0) {
        scheduleSummaryFlush();
      }
    });
}

async function flushSummaryEvents(): Promise<void> {
  const batch = pendingSummaryEvents;
  pendingSummaryEvents = [];
  if (batch.length === 0) return;

  let summary: ToolMetricsSummary = {
    updatedAt: batch[batch.length - 1].timestamp,
    totals: makeBucket(),
    tools: {},
  };

  try {
    const raw = await readFile(SUMMARY_FILE, 'utf8');
    summary = JSON.parse(raw) as ToolMetricsSummary;
  } catch {
    // no summary yet
  }

  for (const event of batch) {
    summary.updatedAt = event.timestamp;
    summary.totals = updateBucket(summary.totals ?? makeBucket(), event);
    summary.tools[event.toolName] = updateBucket(summary.tools[event.toolName] ?? makeBucket(), event);
  }

  await writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), 'utf8');
}

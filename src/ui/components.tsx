/**
 * @fileoverview SETH UI — React+Ink bileşen sistemi.
 * Spinner, ToolCall, ToolResult, Stats, StatusBar, ContextBar bileşenleri.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';

// ─── Spinner ──────────────────────────────────────────────────────────────────

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const THINK_MESSAGES = [
  'Düşünüyor…',
  'Bağlam inceleniyor…',
  'Strateji planlanıyor…',
  'Seçenekler değerlendiriliyor…',
  'Derin analiz yapılıyor…',
  'Araçlar kontrol ediliyor…',
];

export interface SpinnerProps {
  text?: string;
  thinking?: boolean;
  mode?: 'minimal' | 'animated';
}

export function Spinner({ text, thinking = false, mode = 'animated' }: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const frameTimer = setInterval(() => {
      setFrame(f => (f + 1) % BRAILLE_FRAMES.length);
    }, 80);
    return () => clearInterval(frameTimer);
  }, []);

  useEffect(() => {
    if (!thinking || mode === 'minimal') return;
    const msgTimer = setInterval(() => {
      setMsgIdx(i => (i + 1) % THINK_MESSAGES.length);
    }, 3000);
    return () => clearInterval(msgTimer);
  }, [thinking, mode]);

  const symbol = BRAILLE_FRAMES[frame]!;
  const displayText = thinking && mode === 'animated'
    ? (THINK_MESSAGES[msgIdx] ?? 'Düşünüyor…')
    : (text ?? 'Çalışıyor…');

  return (
    <Box>
      <Text color={thinking ? 'gray' : 'blue'}>{symbol} </Text>
      <Text dimColor>{displayText}</Text>
    </Box>
  );
}

// ─── Tool Call / Result ────────────────────────────────────────────────────────

export interface ToolCallDisplayProps {
  name: string;
  detail: string;
}

export function ToolCallDisplay({ name, detail }: ToolCallDisplayProps) {
  return (
    <Box marginLeft={2}>
      <Text color="yellow">⏺ </Text>
      <Text bold color="white">{getToolDisplayName(name)}</Text>
      <Text dimColor> · {detail.slice(0, 72)}</Text>
    </Box>
  );
}

export interface ToolResultDisplayProps {
  name: string;
  output: string;
  isError: boolean;
}

export function ToolResultDisplay({ name, output, isError }: ToolResultDisplayProps) {
  if (isError) {
    const first = output.split('\n').find(l => l.trim()) ?? output;
    return (
      <Box marginLeft={6}>
        <Text color="red">● </Text>
        <Text color="red">{first.slice(0, 110)}</Text>
      </Box>
    );
  }

  if (name === 'file_write' || name === 'file_edit') {
    return (
      <Box marginLeft={6}>
        <Text color="cyan">✓ </Text>
        <Text>Dosya başarıyla güncellendi.</Text>
      </Box>
    );
  }

  if (name === 'gorev_ekle' || name === 'gorev_guncelle' || name === 'gorev_yaz') {
    const first = output.trim().split('\n')[0] ?? '';
    return (
      <Box marginLeft={6}>
        <Text color="green">✓ </Text>
        <Text color="white">{first}</Text>
      </Box>
    );
  }

  const lines = output.split('\n').filter(l => l.trim());
  const first = lines[0] ?? '';
  const extra = lines.length > 1 ? ` +${lines.length - 1}` : '';
  return (
    <Box marginLeft={6}>
      <Text color="green">● </Text>
      <Text dimColor>{first.slice(0, 110)}{extra}</Text>
    </Box>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

export interface StatsBarProps {
  inputTokens: number;
  outputTokens: number;
  turns: number;
  budgetTokens?: number;
}

export function StatsBar({ inputTokens, outputTokens, turns, budgetTokens }: StatsBarProps) {
  const total = inputTokens + outputTokens;
  if (total === 0 && turns === 0) return null;

  const parts: string[] = [];
  if (total > 0) {
    const kStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    parts.push(`${kStr} token`);
  }
  if (budgetTokens && budgetTokens > 0) {
    const pct = Math.min(100, Math.round((total / budgetTokens) * 100));
    parts.push(`${pct}% bütçe`);
  }
  if (turns > 1) parts.push(`${turns} tur`);

  return (
    <Box marginLeft={2}>
      <Text dimColor>{parts.join(' · ')}</Text>
    </Box>
  );
}

// ─── Context Progress Bar ─────────────────────────────────────────────────────

export interface ContextBarProps {
  usedTokens: number;
  budgetTokens: number;
  width?: number;
}

export function ContextBar({ usedTokens, budgetTokens, width = 20 }: ContextBarProps) {
  if (budgetTokens <= 0) return null;
  const pct = Math.min(1, usedTokens / budgetTokens);
  const filled = Math.round(pct * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = pct > 0.85 ? 'red' : pct > 0.6 ? 'yellow' : 'green';
  const pctStr = `${Math.round(pct * 100)}%`;

  return (
    <Box>
      <Text color={color}>{bar}</Text>
      <Text dimColor> {pctStr}</Text>
    </Box>
  );
}

// ─── Status Line (prompt benzeri) ─────────────────────────────────────────────

export interface StatusLineProps {
  provider: string;
  model: string;
  lane?: 'a' | 'b';
  messages: number;
  tokens: number;
  budgetTokens?: number;
  planMode?: boolean;
  agentEnabled?: boolean;
}

export function StatusLine({
  provider,
  model,
  lane,
  messages,
  tokens,
  budgetTokens,
  planMode,
  agentEnabled,
}: StatusLineProps) {
  const tokenStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
  const budgetStr = budgetTokens && budgetTokens >= 1000
    ? `${(budgetTokens / 1000).toFixed(0)}k`
    : budgetTokens ? `${budgetTokens}` : '';

  const lanePart = lane ? `${lane.toUpperCase()} · ` : '';
  const budgetPart = budgetStr ? `/${budgetStr}` : '';
  const contextInfo = messages > 0 || tokens > 0
    ? `${lanePart}${messages}msg · ${tokenStr}tok${budgetPart}`
    : '';

  return (
    <Box flexDirection="row" gap={1}>
      <Text color="blue">{'>'}</Text>
      {contextInfo ? <Text dimColor>[{contextInfo}]</Text> : null}
      {planMode ? <Text color="yellow" bold>[PLAN]</Text> : null}
      {agentEnabled ? <Text color="cyan" dimColor>[ajan]</Text> : null}
    </Box>
  );
}

// ─── Plan Mode Banner ─────────────────────────────────────────────────────────

export function PlanModeBanner() {
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Box flexDirection="column">
        <Text color="yellow" bold>📋 PLAN MODU AKTİF</Text>
        <Text dimColor>Ajan önce planı gösterecek. Onayla → LLM planı uygular.</Text>
        <Text dimColor>Onaylamak için: <Text color="white">onayla</Text> veya <Text color="white">e</Text> · Reddetmek için: <Text color="white">hayır</Text></Text>
      </Box>
    </Box>
  );
}

// ─── Plan Display ─────────────────────────────────────────────────────────────

export interface PlanDisplayProps {
  plan: string;
  onApprove?: () => void;
  onReject?: () => void;
}

export function PlanDisplay({ plan }: PlanDisplayProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="single" borderColor="yellow" paddingX={1} marginBottom={1}>
        <Text color="yellow" bold>📋 AJAN PLANI</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{plan}</Text>
      </Box>
      <Box marginTop={1} paddingLeft={2}>
        <Text dimColor>Planı onayla: </Text>
        <Text color="green">onayla</Text>
        <Text dimColor>  ·  Reddet: </Text>
        <Text color="red">hayır</Text>
      </Box>
    </Box>
  );
}

// ─── Agent Sub-Task Indicator ─────────────────────────────────────────────────

export interface SubAgentIndicatorProps {
  depth: number;
  taskName?: string;
  turn: number;
  maxTurns: number;
}

export function SubAgentIndicator({ depth, taskName, turn, maxTurns }: SubAgentIndicatorProps) {
  const indent = '  '.repeat(depth);
  const depthColor = depth === 1 ? 'cyan' : depth === 2 ? 'magenta' : 'white';
  return (
    <Box marginLeft={depth * 2}>
      <Text color={depthColor}>{indent}↳ </Text>
      <Text color={depthColor} bold>Alt-Ajan [{depth}]</Text>
      {taskName ? <Text> {taskName}</Text> : null}
      <Text dimColor> ({turn}/{maxTurns})</Text>
    </Box>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

export interface WelcomeScreenProps {
  provider: string;
  model: string;
  cwd: string;
  version: string;
}

export function WelcomeScreen({ provider, model, cwd, version }: WelcomeScreenProps) {
  const shortModel = model.length > 32 ? model.slice(0, 29) + '…' : model;
  const shortCwd = cwd.replace(process.env.HOME ?? '', '~');

  return (
    <Box flexDirection="column">
      <Text color="blue">  ███████╗██████╗  █████╗      ██████╗ ██████╗ ██████╗ ███████╗</Text>
      <Text color="blue">  ██╔════╝██╔══██╗██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝</Text>
      <Text color="blue">  █████╗  ██║  ██║███████║    ██║     ██║   ██║██║  ██║█████╗  </Text>
      <Text color="blue">  ██╔══╝  ██║  ██║██╔══██║    ██║     ██║   ██║██║  ██║██╔══╝  </Text>
      <Text color="blue">  ███████╗██████╔╝██║  ██║    ╚██████╗╚██████╔╝██████╔╝███████╗</Text>
      <Text color="blue">  ╚══════╝╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝<Text dimColor> v{version}</Text></Text>
      <Box marginTop={1} flexDirection="column">
        <Text>  Selam! 👋</Text>
        <Text> </Text>
        <Text>  Nasıl yardımcı olabilirim? Bir proje mi var, kod mu yazılacak,</Text>
        <Text>  yoksa yeni bir uygulama mı düşünüyorsun?</Text>
        <Text> </Text>
        <Text color="blue">  ✦ {provider}/{shortModel}</Text>
        <Text dimColor>  ⌂ {shortCwd}</Text>
        <Text> </Text>
        <Text dimColor>  /yardim → komutlar  •  Ctrl+C → iptal  •  Ctrl+D → çıkış</Text>
      </Box>
    </Box>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getToolDisplayName(name: string): string {
  const map: Record<string, string> = {
    shell: 'Terminal',
    file_write: 'Yazma',
    file_read: 'Okuma',
    file_edit: 'Düzenleme',
    list_directory: 'Dizin',
    search: 'Arama',
    grep: 'Arama',
    glob: 'Tarama',
    batch_read: 'Toplu Okuma',
    web_fetch: 'Web Fetch',
    web_ara: 'Web Arama',
    web_search: 'Gerçek Web Arama',
    mcp_arac: 'MCP',
    gorev_ekle: 'Görev Ekle',
    gorev_guncelle: 'Görev Güncelle',
    gorev_oku: 'Görev Oku',
    gorev_yaz: 'Görev Yaz',
    takim_olustur: 'Takım Oluştur',
    takim_oku: 'Takım Oku',
    git_status: 'Git Status',
    git_diff: 'Git Diff',
    git_log: 'Git Log',
    repo_ozet: 'Repo Özet',
    arac_ara: 'Araç Ara',
    agent_spawn: 'Alt-Ajan',
    enter_plan_mode: 'Plan Modu Gir',
    exit_plan_mode: 'Plan Modu Çık',
  };
  return map[name] ?? name;
}

export function formatToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'shell': return String(input.command ?? '').slice(0, 72);
    case 'file_read':
    case 'file_write':
    case 'file_edit': return String(input.path ?? '');
    case 'search':
    case 'grep': return `"${input.query}" in ${input.dir ?? '.'}`;
    case 'list_directory': return String(input.path ?? '.');
    case 'glob': return String(input.pattern ?? '');
    case 'batch_read': return `${(input.paths as string[] | undefined)?.length ?? 0} dosya`;
    case 'web_ara': return String(input.sorgu ?? '');
    case 'web_search': return String(input.sorgu ?? '');
    case 'arac_ara': return String(input.sorgu ?? '');
    case 'mcp_arac': return `${input.islem} @ ${input.sunucu}`;
    case 'gorev_ekle': return `${input.id} ${input.baslik}`;
    case 'gorev_guncelle': return String(input.id ?? '');
    case 'takim_olustur':
    case 'takim_oku': return String(input.takim_adi ?? '');
    case 'agent_spawn': return String(input.task ?? '');
    default: return JSON.stringify(input).slice(0, 72);
  }
}

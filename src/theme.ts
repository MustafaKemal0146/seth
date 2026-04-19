/**
 * Seth tema sistemi — lazy renk hesaplama
 *
 * Sorun: modül yüklenince sabit değer atanıyordu, setTheme sonrası güncellenmiyordu.
 * Çözüm: tüm renk fonksiyonları lazy — her çağrıda getCurrentTheme()'den hesaplar.
 * Tema settings.json'a kaydedilir, başlangıçta yüklenir.
 */

import chalk from 'chalk';

export type Theme = {
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  dim: string;
  success: string;
  warning: string;
  error: string;
  prompt: string;
  tool: string;
  cmd: string;
};

const THEME_DEFS: Record<string, Theme> = {
  dark: {
    primary:   '#1e88e5',
    secondary: '#42a5f5',
    accent:    '#64b5f6',
    muted:     '#90a4ae',
    dim:       '#bbdefb',
    success:   '#4caf50',
    warning:   '#ff9800',
    error:     '#f44336',
    prompt:    '#64b5f6',
    tool:      '#7986cb',
    cmd:       '#42a5f5',
  },
  light: {
    primary:   '#0d47a1',
    secondary: '#1565c0',
    accent:    '#1976d2',
    muted:     '#546e7a',
    dim:       '#78909c',
    success:   '#2e7d32',
    warning:   '#f57c00',
    error:     '#c62828',
    prompt:    '#1976d2',
    tool:      '#512da8',
    cmd:       '#1565c0',
  },
  cyberpunk: {
    primary:   '#00ff41',
    secondary: '#ff0080',
    accent:    '#00ffff',
    muted:     '#808080',
    dim:       '#404040',
    success:   '#00ff00',
    warning:   '#ffff00',
    error:     '#ff0000',
    prompt:    '#00ff41',
    tool:      '#ff0080',
    cmd:       '#00ffff',
  },
  retro: {
    primary:   '#ff6b35',
    secondary: '#f7931e',
    accent:    '#ffcc02',
    muted:     '#a0a0a0',
    dim:       '#606060',
    success:   '#7cb342',
    warning:   '#ff8f00',
    error:     '#e53935',
    prompt:    '#ff6b35',
    tool:      '#8e24aa',
    cmd:       '#f7931e',
  },
  ocean: {
    primary:   '#006064',
    secondary: '#00838f',
    accent:    '#26c6da',
    muted:     '#80cbc4',
    dim:       '#b2dfdb',
    success:   '#00897b',
    warning:   '#f9a825',
    error:     '#d32f2f',
    prompt:    '#26c6da',
    tool:      '#0288d1',
    cmd:       '#00838f',
  },
  sunset: {
    primary:   '#e91e63',
    secondary: '#f06292',
    accent:    '#ff8a65',
    muted:     '#bcaaa4',
    dim:       '#d7ccc8',
    success:   '#66bb6a',
    warning:   '#ffa726',
    error:     '#ef5350',
    prompt:    '#f06292',
    tool:      '#ab47bc',
    cmd:       '#ff8a65',
  },
};

export const THEMES = THEME_DEFS;
export type ThemeName = keyof typeof THEME_DEFS;

let _current: ThemeName = 'dark';

export function setTheme(name: ThemeName): void {
  if (THEME_DEFS[name]) _current = name;
}

export function getCurrentTheme(): Theme {
  return THEME_DEFS[_current]!;
}

export function getThemeName(): ThemeName {
  return _current;
}

// ─── Lazy renk fonksiyonları — her çağrıda güncel temayı kullanır ─────────────

export function getThemeColors() {
  const t = getCurrentTheme();
  return {
    navy:         chalk.hex(t.primary),
    navyBright:   chalk.hex(t.secondary),
    navyMuted:    chalk.hex(t.muted),
    navyDim:      chalk.hex(t.dim).dim,
    promptAccent: chalk.hex(t.prompt),
    promptBright: chalk.hex(t.prompt).bold,
    cmd:          chalk.hex(t.cmd),
    toolAccent:   chalk.hex(t.tool),
    sparkle:      chalk.hex(t.accent),
    success:      chalk.hex(t.success),
    warning:      chalk.hex(t.warning),
    error:        chalk.hex(t.error),
  };
}

// Geriye uyumluluk: doğrudan import eden dosyalar için proxy fonksiyonlar
// Sabit değer yerine her çağrıda hesaplanır → tema değişince anında güncellenir

export const navy         = (s: string) => chalk.hex(getCurrentTheme().primary)(s);
export const navyBright   = (s: string) => chalk.hex(getCurrentTheme().secondary)(s);
export const navyMuted    = (s: string) => chalk.hex(getCurrentTheme().muted)(s);
export const navyDim      = (s: string) => chalk.hex(getCurrentTheme().dim).dim(s);
export const promptAccent = (s: string) => chalk.hex(getCurrentTheme().prompt)(s);
export const promptBright = (s: string) => chalk.hex(getCurrentTheme().prompt).bold(s);
export const cmd          = (s: string) => chalk.hex(getCurrentTheme().cmd)(s);
export const toolAccent   = (s: string) => chalk.hex(getCurrentTheme().tool)(s);
export const sparkle      = (s: string) => chalk.hex(getCurrentTheme().accent)(s);

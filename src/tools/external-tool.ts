/**
 * @fileoverview External tool manager — siber güvenlik araçları
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import type { ToolDefinition, ToolResult } from '../types.js';

interface ExternalToolConfig {
  name: string;
  command: string;
  install: { linux: string; macos: string };
  versionArgs: string[];
  commonArgs?: string[];
}

const TOOLS: Record<string, ExternalToolConfig> = {
  sqlmap:    { name: 'sqlmap',    command: 'sqlmap',    install: { linux: 'sudo apt install sqlmap',          macos: 'brew install sqlmap' },    versionArgs: ['--version'], commonArgs: ['--batch', '--random-agent'] },
  nmap:      { name: 'nmap',      command: 'nmap',      install: { linux: 'sudo apt install nmap',            macos: 'brew install nmap' },      versionArgs: ['--version'] },
  nikto:     { name: 'nikto',     command: 'nikto',     install: { linux: 'sudo apt install nikto',           macos: 'brew install nikto' },     versionArgs: ['-Version'] },
  gobuster:  { name: 'gobuster',  command: 'gobuster',  install: { linux: 'sudo apt install gobuster',        macos: 'brew install gobuster' },  versionArgs: ['version'] },
  whois:     { name: 'whois',     command: 'whois',     install: { linux: 'sudo apt install whois',           macos: 'brew install whois' },     versionArgs: ['--version'] },
  dig:       { name: 'dig',       command: 'dig',       install: { linux: 'sudo apt install dnsutils',        macos: 'brew install bind' },      versionArgs: ['-v'] },
  whatweb:   { name: 'whatweb',   command: 'whatweb',   install: { linux: 'sudo apt install whatweb',         macos: 'brew install whatweb' },   versionArgs: ['--version'] },
  ffuf:      { name: 'ffuf',      command: 'ffuf',      install: { linux: 'sudo apt install ffuf',            macos: 'brew install ffuf' },      versionArgs: ['-V'] },
  nuclei:    { name: 'nuclei',    command: 'nuclei',    install: { linux: 'go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest', macos: 'brew install nuclei' }, versionArgs: ['-version'] },
  masscan:   { name: 'masscan',   command: 'masscan',   install: { linux: 'sudo apt install masscan',         macos: 'brew install masscan' },   versionArgs: ['--version'] },
  nc:        { name: 'nc',        command: 'nc',        install: { linux: 'sudo apt install netcat-openbsd',  macos: 'brew install netcat' },    versionArgs: ['-h'] },
  wpscan:    { name: 'wpscan',    command: 'wpscan',    install: { linux: 'sudo gem install wpscan',          macos: 'brew install wpscan' },    versionArgs: ['--version'] },
  subfinder: { name: 'subfinder', command: 'subfinder', install: { linux: 'go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest', macos: 'brew install subfinder' }, versionArgs: ['-version'] },
};

async function isInstalled(toolName: string): Promise<boolean> {
  const t = TOOLS[toolName];
  if (!t) return false;
  return new Promise(resolve => {
    const c = spawn(t.command, t.versionArgs, { stdio: 'ignore' });
    c.on('close', code => resolve(code === 0 || code === 1));
    c.on('error', () => resolve(false));
  });
}

async function run(toolName: string, args: string[], cwd: string): Promise<ToolResult> {
  const t = TOOLS[toolName];
  if (!t) return { output: `Bilinmeyen araç: ${toolName}`, isError: true };
  if (!(await isInstalled(toolName))) {
    const os = platform() === 'darwin' ? 'macos' : 'linux';
    return { output: `❌ ${t.name} yüklü değil.\n\nKurulum:\n  ${t.install[os]}`, isError: true };
  }
  return new Promise(resolve => {
    const allArgs = [...(t.commonArgs ?? []), ...args];
    const child = spawn(t.command, allArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout?.on('data', d => out += d);
    child.stderr?.on('data', d => err += d);
    child.on('close', code => resolve({
      output: (out + (err ? `\n[STDERR]\n${err}` : '')).trim() || `${t.name} tamamlandı (kod: ${code})`,
      isError: code !== 0 && code !== null,
    }));
    child.on('error', e => resolve({ output: `${t.name} çalıştırılamadı: ${e.message}`, isError: true }));
  });
}

// ─── Tool tanımları ───────────────────────────────────────────────────────────

export const sqlmapTool: ToolDefinition = {
  name: 'sqlmap',
  description: 'SQL injection testi yapar. URL, form parametreleri ve veritabanı sızma testleri.',
  inputSchema: {
    type: 'object',
    properties: {
      url:    { type: 'string', description: 'Hedef URL (örn: http://site.com/page.php?id=1)' },
      data:   { type: 'string', description: 'POST verisi' },
      cookie: { type: 'string', description: 'Cookie değerleri' },
      level:  { type: 'number', description: 'Test seviyesi 1-5' },
      risk:   { type: 'number', description: 'Risk seviyesi 1-3' },
      dbs:    { type: 'boolean', description: 'Veritabanlarını listele' },
      tables: { type: 'boolean', description: 'Tabloları listele' },
      dump:   { type: 'boolean', description: 'Veri çek' },
    },
    required: ['url'],
  },
  isDestructive: true, requiresConfirmation: true,
  async execute(input, cwd) {
    const args = ['-u', input.url as string];
    if (input.data)   args.push('--data', input.data as string);
    if (input.cookie) args.push('--cookie', input.cookie as string);
    if (input.level)  args.push('--level', String(input.level));
    if (input.risk)   args.push('--risk', String(input.risk));
    if (input.dbs)    args.push('--dbs');
    if (input.tables) args.push('--tables');
    if (input.dump)   args.push('--dump');
    return run('sqlmap', args, cwd);
  },
};

export const nmapTool: ToolDefinition = {
  name: 'nmap',
  description: 'Ağ tarama ve port keşfi. Açık portlar, servisler, OS tespiti, NSE scriptleri.',
  inputSchema: {
    type: 'object',
    properties: {
      target:            { type: 'string', description: 'Hedef IP veya domain' },
      ports:             { type: 'string', description: 'Port aralığı (örn: 1-1000, 80,443)' },
      scan_type:         { type: 'string', enum: ['tcp', 'udp', 'syn', 'connect'], description: 'Tarama türü' },
      service_detection: { type: 'boolean', description: 'Servis versiyonu tespit (-sV)' },
      os_detection:      { type: 'boolean', description: 'OS tespit (-O)' },
      aggressive:        { type: 'boolean', description: 'Agresif tarama (-A)' },
      scripts:           { type: 'string', description: 'NSE script (örn: vuln, default, safe)' },
    },
    required: ['target'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const args: string[] = [];
    if (input.ports) args.push('-p', input.ports as string);
    switch (input.scan_type) {
      case 'syn': args.push('-sS'); break;
      case 'connect': args.push('-sT'); break;
      case 'udp': args.push('-sU'); break;
      default: args.push('-sS');
    }
    if (input.service_detection) args.push('-sV');
    if (input.os_detection) args.push('-O');
    if (input.aggressive) args.push('-A');
    if (input.scripts) args.push(`--script=${input.scripts as string}`);
    args.push(input.target as string);
    return run('nmap', args, cwd);
  },
};

export const niktoTool: ToolDefinition = {
  name: 'nikto',
  description: 'Web sunucu güvenlik açığı taraması. CGI, SSL, eski yazılım, yanlış yapılandırma tespiti.',
  inputSchema: {
    type: 'object',
    properties: {
      host:    { type: 'string', description: 'Hedef host (örn: http://example.com)' },
      port:    { type: 'number', description: 'Port numarası' },
      ssl:     { type: 'boolean', description: 'SSL kullan' },
      evasion: { type: 'string', description: 'Kaçınma tekniği (1-9)' },
    },
    required: ['host'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const args = ['-h', input.host as string];
    if (input.port) args.push('-p', String(input.port));
    if (input.ssl) args.push('-ssl');
    if (input.evasion) args.push('-evasion', input.evasion as string);
    return run('nikto', args, cwd);
  },
};

export const gobusterTool: ToolDefinition = {
  name: 'gobuster',
  description: 'Dizin ve dosya brute force taraması. Gizli dizinleri, dosyaları ve subdomainleri bulur.',
  inputSchema: {
    type: 'object',
    properties: {
      url:          { type: 'string', description: 'Hedef URL' },
      mode:         { type: 'string', enum: ['dir', 'dns', 'vhost'], description: 'Tarama modu (varsayılan: dir)' },
      wordlist:     { type: 'string', description: 'Wordlist dosya yolu' },
      extensions:   { type: 'string', description: 'Dosya uzantıları (örn: php,html,txt)' },
      threads:      { type: 'number', description: 'Thread sayısı' },
      status_codes: { type: 'string', description: 'Kabul edilecek HTTP kodları' },
    },
    required: ['url'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const mode = (input.mode as string) || 'dir';
    const args = [mode, '-u', input.url as string];
    if (input.wordlist) {
      args.push('-w', input.wordlist as string);
    } else {
      const wl = [
        '/usr/share/wordlists/dirb/common.txt',
        '/usr/share/seclists/Discovery/Web-Content/common.txt',
        '/opt/SecLists/Discovery/Web-Content/common.txt',
      ].find(p => existsSync(p));
      if (!wl) return { output: 'Wordlist bulunamadı. wordlist parametresi verin veya SecLists kurun:\ngit clone https://github.com/danielmiessler/SecLists.git /opt/SecLists', isError: true };
      args.push('-w', wl);
    }
    if (input.extensions) args.push('-x', input.extensions as string);
    if (input.threads) args.push('-t', String(input.threads));
    if (input.status_codes) args.push('-s', input.status_codes as string);
    return run('gobuster', args, cwd);
  },
};

export const whoisTool: ToolDefinition = {
  name: 'whois',
  description: 'Domain veya IP için WHOIS kayıt bilgisi. Sahip, kayıt tarihi, nameserver, iletişim bilgisi.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Domain veya IP (örn: example.com, 8.8.8.8)' },
    },
    required: ['target'],
  },
  isDestructive: false, requiresConfirmation: false,
  async execute(input, cwd) {
    return run('whois', [input.target as string], cwd);
  },
};

export const digTool: ToolDefinition = {
  name: 'dig',
  description: 'DNS sorguları. A, MX, NS, TXT, CNAME kayıtları. Subdomain ve mail sunucu keşfi.',
  inputSchema: {
    type: 'object',
    properties: {
      domain:      { type: 'string', description: 'Sorgulanacak domain (örn: example.com)' },
      record_type: { type: 'string', enum: ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'ANY'], description: 'DNS kayıt tipi (varsayılan: A)' },
      nameserver:  { type: 'string', description: 'Kullanılacak nameserver (örn: 8.8.8.8)' },
      short:       { type: 'boolean', description: 'Sadece sonucu göster' },
    },
    required: ['domain'],
  },
  isDestructive: false, requiresConfirmation: false,
  async execute(input, cwd) {
    const args: string[] = [];
    if (input.nameserver) args.push(`@${input.nameserver as string}`);
    args.push(input.domain as string);
    args.push((input.record_type as string) || 'A');
    if (input.short) args.push('+short');
    return run('dig', args, cwd);
  },
};

export const whatwebTool: ToolDefinition = {
  name: 'whatweb',
  description: 'Web sitesi teknoloji tespiti. CMS, framework, sunucu yazılımı, JS kütüphaneleri, WAF.',
  inputSchema: {
    type: 'object',
    properties: {
      url:        { type: 'string', description: 'Hedef URL (örn: https://example.com)' },
      aggression: { type: 'number', description: 'Agresiflik 1-4 (1=pasif, 4=agresif, varsayılan: 1)' },
      verbose:    { type: 'boolean', description: 'Detaylı çıktı' },
    },
    required: ['url'],
  },
  isDestructive: false, requiresConfirmation: false,
  async execute(input, cwd) {
    const args = [input.url as string];
    if (input.aggression) args.push(`-a${input.aggression as number}`);
    if (input.verbose) args.push('-v');
    return run('whatweb', args, cwd);
  },
};

export const ffufTool: ToolDefinition = {
  name: 'ffuf',
  description: 'Hızlı web fuzzer. Dizin, parametre, subdomain keşfi. URL\'de FUZZ keyword kullanılır.',
  inputSchema: {
    type: 'object',
    properties: {
      url:         { type: 'string', description: 'Hedef URL — FUZZ ile (örn: https://example.com/FUZZ)' },
      wordlist:    { type: 'string', description: 'Wordlist dosya yolu' },
      extensions:  { type: 'string', description: 'Dosya uzantıları (örn: php,html)' },
      threads:     { type: 'number', description: 'Thread sayısı (varsayılan: 40)' },
      filter_code: { type: 'string', description: 'Filtrelenecek HTTP kodları (örn: 404,403)' },
      match_code:  { type: 'string', description: 'Eşleşecek HTTP kodları (örn: 200,301)' },
      headers:     { type: 'string', description: 'HTTP header (örn: Authorization: Bearer token)' },
    },
    required: ['url'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const args = ['-u', input.url as string];
    const wl = (input.wordlist as string) ||
      ['/usr/share/wordlists/dirb/common.txt', '/opt/SecLists/Discovery/Web-Content/common.txt']
        .find(p => existsSync(p));
    if (!wl) return { output: 'Wordlist bulunamadı. wordlist parametresi verin.', isError: true };
    args.push('-w', wl);
    if (input.extensions) args.push('-e', input.extensions as string);
    if (input.threads) args.push('-t', String(input.threads));
    if (input.filter_code) args.push('-fc', input.filter_code as string);
    if (input.match_code) args.push('-mc', input.match_code as string);
    if (input.headers) args.push('-H', input.headers as string);
    args.push('-v');
    return run('ffuf', args, cwd);
  },
};

export const nucleiTool: ToolDefinition = {
  name: 'nuclei',
  description: 'Şablon tabanlı zafiyet tarayıcısı. CVE, misconfiguration, exposed panels, takeover tespiti.',
  inputSchema: {
    type: 'object',
    properties: {
      target:    { type: 'string', description: 'Hedef URL veya IP' },
      templates: { type: 'string', description: 'Şablon kategorisi (örn: cves, misconfigurations, exposures, takeovers)' },
      severity:  { type: 'string', description: 'Önem seviyesi (örn: critical,high,medium)' },
      tags:      { type: 'string', description: 'Etiket filtresi (örn: wordpress,apache,nginx)' },
    },
    required: ['target'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const args = ['-u', input.target as string, '-silent'];
    if (input.templates) args.push('-t', input.templates as string);
    if (input.severity) args.push('-severity', input.severity as string);
    if (input.tags) args.push('-tags', input.tags as string);
    return run('nuclei', args, cwd);
  },
};

export const masscanTool: ToolDefinition = {
  name: 'masscan',
  description: 'Çok hızlı port tarayıcı. Nmap\'ten 1000x hızlı, büyük IP aralıklarını saniyeler içinde tarar.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Hedef IP, CIDR veya aralık (örn: 192.168.1.0/24)' },
      ports:  { type: 'string', description: 'Port aralığı (örn: 80,443,1-1000)' },
      rate:   { type: 'number', description: 'Paket/saniye hızı (varsayılan: 1000)' },
    },
    required: ['target', 'ports'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const args = [input.target as string, '-p', input.ports as string, '--rate', String(input.rate || 1000)];
    return run('masscan', args, cwd);
  },
};

export const ncTool: ToolDefinition = {
  name: 'nc',
  description: 'Netcat — port bağlantısı, banner grabbing, port tarama, basit ağ testleri.',
  inputSchema: {
    type: 'object',
    properties: {
      host:    { type: 'string', description: 'Hedef host' },
      port:    { type: 'number', description: 'Port numarası' },
      mode:    { type: 'string', enum: ['connect', 'scan', 'banner'], description: 'Mod (varsayılan: connect)' },
      timeout: { type: 'number', description: 'Zaman aşımı saniye (varsayılan: 3)' },
      udp:     { type: 'boolean', description: 'UDP kullan' },
    },
    required: ['host', 'port'],
  },
  isDestructive: false, requiresConfirmation: false,
  async execute(input, cwd) {
    const args: string[] = [];
    if (input.udp) args.push('-u');
    args.push('-w', String(input.timeout || 3));
    switch ((input.mode as string) || 'connect') {
      case 'scan':   args.push('-z', '-v', input.host as string, String(input.port)); break;
      case 'banner': args.push('-v', input.host as string, String(input.port)); break;
      default:       args.push(input.host as string, String(input.port));
    }
    return run('nc', args, cwd);
  },
};

export const wpscanTool: ToolDefinition = {
  name: 'wpscan',
  description: 'WordPress güvenlik tarayıcısı. Plugin, tema, kullanıcı, zafiyet ve brute force tespiti.',
  inputSchema: {
    type: 'object',
    properties: {
      url:       { type: 'string', description: 'WordPress site URL' },
      enumerate: { type: 'string', description: 'Numaralandırma: u=kullanıcılar, p=pluginler, t=temalar, vp=zafiyet pluginler' },
      api_token: { type: 'string', description: 'WPScan API token (zafiyet DB için)' },
      passwords: { type: 'string', description: 'Şifre wordlist yolu' },
      usernames: { type: 'string', description: 'Kullanıcı adı veya liste' },
    },
    required: ['url'],
  },
  isDestructive: false, requiresConfirmation: true,
  async execute(input, cwd) {
    const args = ['--url', input.url as string, '--no-banner'];
    if (input.enumerate) args.push('--enumerate', input.enumerate as string);
    if (input.api_token) args.push('--api-token', input.api_token as string);
    if (input.passwords) args.push('--passwords', input.passwords as string);
    if (input.usernames) args.push('--usernames', input.usernames as string);
    return run('wpscan', args, cwd);
  },
};

export const subfinderTool: ToolDefinition = {
  name: 'subfinder',
  description: 'Pasif subdomain keşfi. DNS, sertifika şeffaflığı ve OSINT kaynaklarından subdomain bulur.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Hedef domain (örn: example.com)' },
      silent: { type: 'boolean', description: 'Sadece subdomainleri çıkar' },
      output: { type: 'string', description: 'Çıktı dosyası' },
    },
    required: ['domain'],
  },
  isDestructive: false, requiresConfirmation: false,
  async execute(input, cwd) {
    const args = ['-d', input.domain as string];
    if (input.silent) args.push('-silent');
    if (input.output) args.push('-o', input.output as string);
    return run('subfinder', args, cwd);
  },
};

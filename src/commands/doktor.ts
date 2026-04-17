/**
 * @fileoverview /doktor komutu — sistem sağlık kontrolü ve araç kurulumu.
 */

import chalk from 'chalk';
import { VERSION } from '../version.js';
import type { CommandContext, CommandResult } from '../commands.js';

type ToolEntry = [string, string, string, string, boolean];

async function checkboxSelect<T extends ToolEntry>(items: T[]): Promise<T[]> {
  return new Promise(resolve => {
    const selected = new Set<number>(items.map((_, i) => i));
    let cursor = 0;
    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(chalk.bold('  Kurulacak araçları seçin:\n'));
      process.stdout.write(chalk.dim('  Boşluk: seç/kaldır  •  Enter: onayla  •  ↑↓: gezin\n\n'));
      items.forEach((item, i) => {
        const isSel = selected.has(i);
        const isCur = i === cursor;
        const box = isSel ? chalk.green('◉') : chalk.dim('○');
        const line = `  ${box} ${item[0].padEnd(12)} ${chalk.dim(item[1])}`;
        process.stdout.write(isCur ? chalk.bgHex('#2a2a2a').white(line.padEnd(50)) + '\n' : line + '\n');
      });
      process.stdout.write(`\n  ${chalk.green(selected.size + ' araç seçili')} — Enter ile kur\n`);
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    render();
    const onData = (key: string) => {
      if (key === '\x03') { cleanup(); resolve([]); return; }
      if (key === '\r' || key === '\n') { cleanup(); resolve(items.filter((_, i) => selected.has(i))); return; }
      if (key === ' ') { selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor); render(); return; }
      if (key === '\x1b[A' && cursor > 0) { cursor--; render(); }
      if (key === '\x1b[B' && cursor < items.length - 1) { cursor++; render(); }
    };
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\x1b[2J\x1b[H');
    };
    process.stdin.on('data', onData);
  });
}

export async function runDoktor(ctx: CommandContext): Promise<CommandResult> {
  const { execSync, spawnSync } = await import('child_process');
  const { select: clackSelect, isCancel } = await import('@clack/prompts');

  const checkCmd = (c: string): boolean => {
    try { execSync(`which ${c}`, { stdio: 'ignore' }); return true; } catch { return false; }
  };

  const allTools: ToolEntry[] = [
    ['curl',      'HTTP istekleri',           'curl',           'curl',       true],
    ['git',       'Versiyon kontrolü',         'git',            'git',        true],
    ['node',      'Node.js runtime',           'nodejs',         'node',       true],
    ['python3',   'Python runtime',            'python3',        'python3',    false],
    ['jq',        'JSON işleme',               'jq',             'jq',         false],
    ['rg',        'Ripgrep (hızlı arama)',      'ripgrep',        'ripgrep',    false],
    ['nmap',      'Ağ tarama',                 'nmap',           'nmap',       false],
    ['nikto',     'Web zafiyet tarayıcı',       'nikto',          'nikto',      false],
    ['gobuster',  'Dizin brute force',          'gobuster',       'gobuster',   false],
    ['sqlmap',    'SQL injection testi',        'sqlmap',         'sqlmap',     false],
    ['whois',     'WHOIS sorgusu',              'whois',          'whois',      false],
    ['dig',       'DNS sorguları',              'dnsutils',       'bind',       false],
    ['whatweb',   'Web teknoloji tespiti',      'whatweb',        'whatweb',    false],
    ['ffuf',      'Web fuzzer',                 'ffuf',           'ffuf',       false],
    ['masscan',   'Hızlı port tarayıcı',        'masscan',        'masscan',    false],
    ['nc',        'Netcat',                     'netcat-openbsd', 'netcat',     false],
    ['nuclei',    'Zafiyet tarayıcı',           'golang-go',      'nuclei',     false],
    ['subfinder', 'Subdomain keşfi',            'golang-go',      'subfinder',  false],
  ];

  const isMac = process.platform === 'darwin';
  const hasBrew = checkCmd('brew');
  const hasApt  = checkCmd('apt');

  const lines: string[] = [
    chalk.bold('🏥 SETH Sistem Sağlık Kontrolü'),
    `  Versiyon : ${VERSION}`,
    `  Sağlayıcı: ${ctx.currentProvider}`,
    `  Model    : ${ctx.currentModel}`,
    `  Dizin    : ${ctx.getCwd()}`,
    `  İzin     : ${ctx.getPermissionLevel()}`,
    '',
    chalk.bold('🔧 Araç Durumu'),
  ];

  const missing: ToolEntry[] = [];
  for (const entry of allTools) {
    const [c, desc] = entry;
    const ok = checkCmd(c);
    const tag = entry[4] ? chalk.dim('(zorunlu)') : '';
    lines.push(`  ${ok ? chalk.green('✓') : chalk.red('✗')} ${c.padEnd(12)} ${chalk.dim(desc)} ${tag}`);
    if (!ok) missing.push(entry);
  }

  console.log(lines.join('\n'));

  if (missing.length === 0) {
    console.log('\n' + chalk.green('✓ Tüm araçlar mevcut.'));
    return { output: '' };
  }

  console.log('');
  console.log(chalk.yellow(`⚠  ${missing.length} araç eksik.`));

  const installable = missing.filter(([, , apt, brew]) =>
    (hasApt && apt && !apt.includes('gem') && !apt.includes('golang')) ||
    (hasBrew && brew)
  );

  if (installable.length === 0) {
    console.log(chalk.dim('  Otomatik kurulum desteklenmiyor. Manuel kurulum gerekli.'));
    return { output: '' };
  }

  const choice = await clackSelect({
    message: `${installable.length} araç otomatik kurulabilir. Ne yapmak istersiniz?`,
    options: [
      { value: 'all',      label: `Tümünü kur (${installable.length} araç)` },
      { value: 'required', label: 'Sadece zorunlu araçları kur' },
      { value: 'select',   label: 'Seçerek kur' },
      { value: 'skip',     label: 'Şimdi değil' },
    ],
  });

  if (isCancel(choice) || choice === 'skip') return { output: '' };

  let toInstall: ToolEntry[] = [];
  if (choice === 'all') toInstall = installable;
  else if (choice === 'required') toInstall = installable.filter(e => e[4]);
  else if (choice === 'select') {
    toInstall = await checkboxSelect(installable);
    if (toInstall.length === 0) return { output: '' };
  }

  if (toInstall.length === 0) return { output: '' };

  console.log('');
  for (const [c, , apt, brew] of toInstall) {
    const pkg = isMac && hasBrew ? brew : apt;
    const bin = isMac && hasBrew ? 'brew' : 'sudo';
    const args = isMac && hasBrew ? ['install', pkg] : ['apt', 'install', '-y', pkg];
    console.log(chalk.dim(`  → ${c}: ${bin} ${args.join(' ')}`));
    try {
      const result = spawnSync(bin, args, { stdio: 'inherit', encoding: 'utf8' });
      console.log(result.status === 0 ? chalk.green(`  ✓ ${c} kuruldu`) : chalk.red(`  ✗ ${c} kurulamadı`));
    } catch (e: unknown) {
      console.log(chalk.red(`  ✗ ${c}: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  return { output: '' };
}

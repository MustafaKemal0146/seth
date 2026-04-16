import type { ToolDefinition, ToolResult } from '../types.js';

let puppeteer: any = null;
let browserInstance: any = null;
let currentPage: any = null;

async function getPuppeteer() {
  if (!puppeteer) puppeteer = await import('puppeteer');
  return puppeteer;
}

async function getBrowser() {
  if (!browserInstance) {
    const pptr = await getPuppeteer();
    browserInstance = await pptr.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browserInstance;
}

async function getPage() {
  if (!currentPage) {
    const browser = await getBrowser();
    currentPage = await browser.newPage();
    await currentPage.setViewport({ width: 1920, height: 1080 });
    await currentPage.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
  }
  return currentPage;
}

export async function closeBrowser() {
  if (currentPage) { await currentPage.close(); currentPage = null; }
  if (browserInstance) { await browserInstance.close(); browserInstance = null; }
}

export const browserAutomationTool: ToolDefinition = {
  name: 'browser_automation',
  description: 'Tarayıcı otomasyonu — navigate, click, type, screenshot, extract, cookie, execute, wait, scroll, close',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'click', 'type', 'screenshot', 'extract', 'download', 'cookie', 'execute', 'wait', 'scroll', 'close'] },
      url: { type: 'string' },
      selector: { type: 'string' },
      text: { type: 'string' },
      script: { type: 'string' },
      timeout: { type: 'number', default: 5000 },
      format: { type: 'string', enum: ['text', 'html', 'json'], default: 'text' },
      downloadPath: { type: 'string' }
    },
    required: ['action']
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const action = input.action as string;
    try {
      if (action === 'close') { await closeBrowser(); return { output: '✓ Tarayıcı kapatıldı', isError: false }; }
      const page = await getPage();
      switch (action) {
        case 'navigate': {
          await page.goto(input.url as string, { waitUntil: 'networkidle2', timeout: 30000 });
          const title = await page.title();
          return { output: `✓ Sayfa yüklendi: ${input.url}\nBaşlık: ${title}`, isError: false };
        }
        case 'click': await page.click(input.selector as string); return { output: `✓ Tıklandı: ${input.selector}`, isError: false };
        case 'type': await page.type(input.selector as string, input.text as string); return { output: `✓ Yazıldı: "${input.text}" → ${input.selector}`, isError: false };
        case 'screenshot': {
          const path = `${cwd}/screenshot_${Date.now()}.png`;
          await page.screenshot({ path, fullPage: true });
          return { output: `✓ Screenshot: ${path}`, isError: false };
        }
        case 'extract': {
          const format = (input.format as string) || 'text';
          let content: string;
          if (format === 'html') {
            content = await page.content();
          } else if (format === 'json') {
            // @ts-ignore - browser context
            const data = await page.evaluate(() => ({ title: document.title, url: window.location.href, links: Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({ text: a.textContent?.trim(), href: a.href })), forms: Array.from(document.querySelectorAll('form')).map(f => ({ action: f.action, method: f.method, inputs: Array.from(f.querySelectorAll('input')).map(i => ({ name: i.name, type: i.type })) })) }));
            content = JSON.stringify(data, null, 2);
          } else {
            // @ts-ignore - browser context
            content = await page.evaluate(() => document.body.innerText);
          }
          return { output: content.slice(0, 8000), isError: false };
        }
        case 'download': {
          const downloadPath = (input.downloadPath as string) || cwd;
          const client = await page.target().createCDPSession();
          await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
          return { output: `✓ İndirme dizini: ${downloadPath}`, isError: false };
        }
        case 'cookie': return { output: JSON.stringify(await page.cookies(), null, 2), isError: false };
        case 'execute': return { output: JSON.stringify(await page.evaluate(input.script as string), null, 2), isError: false };
        case 'wait': await page.waitForSelector(input.selector as string, { timeout: (input.timeout as number) || 5000 }); return { output: `✓ Element bulundu: ${input.selector}`, isError: false };
        case 'scroll': 
          // @ts-ignore - browser context
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); 
          return { output: '✓ Sayfa kaydırıldı', isError: false };
        default: return { output: `Bilinmeyen eylem: ${action}`, isError: true };
      }
    } catch (err) {
      return { output: `Hata: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }
};

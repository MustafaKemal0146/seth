import chalk from 'chalk';
import { VERSION } from './version.js';
import * as os from 'os';

const SETH_LINES = [
  ' ███████╗███████╗████████╗██╗  ██╗',
  ' ██╔════╝██╔════╝╚══██╔══╝██║  ██║',
  ' ███████╗█████╗     ██║   ███████║',
  ' ╚════██║██╔══╝     ██║   ██╔══██║',
  ' ███████║███████╗   ██║   ██║  ██║',
  ' ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝',
];

const SUBTITLE = '  HİÇBİR SİSTEM GÜVENLİ DEĞİLDİR';

type SnakeNode = { row: number; col: number; depth: 'behind' | 'front' };

const SNAKE_PATH: SnakeNode[] = [
  { row: 5, col: 0,  depth: 'front'  },
  { row: 4, col: 1,  depth: 'front'  },
  { row: 3, col: 2,  depth: 'behind' },
  { row: 2, col: 1,  depth: 'behind' },
  { row: 1, col: 2,  depth: 'front'  },
  { row: 0, col: 4,  depth: 'front'  },
  { row: 1, col: 6,  depth: 'front'  },
  { row: 2, col: 5,  depth: 'behind' },
  { row: 3, col: 7,  depth: 'front'  },
  { row: 4, col: 9,  depth: 'front'  },
  { row: 3, col: 11, depth: 'front'  },
  { row: 2, col: 13, depth: 'behind' },
  { row: 1, col: 15, depth: 'front'  },
  { row: 0, col: 17, depth: 'front'  },
  { row: 1, col: 19, depth: 'front'  },
  { row: 2, col: 18, depth: 'behind' },
  { row: 3, col: 19, depth: 'front'  },
  { row: 4, col: 21, depth: 'front'  },
  { row: 3, col: 23, depth: 'front'  },
  { row: 2, col: 22, depth: 'behind' },
  { row: 1, col: 23, depth: 'front'  },
  { row: 0, col: 24, depth: 'front'  },
  { row: 1, col: 25, depth: 'front'  },
  { row: 2, col: 24, depth: 'behind' },
  { row: 3, col: 25, depth: 'front'  },
  { row: 4, col: 27, depth: 'front'  },
  { row: 3, col: 28, depth: 'behind' },
  { row: 2, col: 27, depth: 'behind' },
  { row: 1, col: 28, depth: 'front'  },
  { row: 2, col: 30, depth: 'front'  },
  { row: 3, col: 31, depth: 'behind' },
  { row: 4, col: 32, depth: 'front'  },
  { row: 5, col: 33, depth: 'front'  },
];

const SNAKE_BODY_CHARS = ['◉', '●', '○', '◌'];
const HEAD_CHAR = '⦿';
const TONGUE_FRAMES = [' ≻', '  ', ' ≻', '  '];
const SNAKE_VISIBLE = 12;

function hideCursor() { process.stdout.write('\x1B[?25l'); }
function showCursor() { process.stdout.write('\x1B[?25h'); }
function moveTo(row: number, col: number) { process.stdout.write(`\x1B[${row + 1};${col + 1}H`); }

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export async function playIntro(provider: string, model: string, userEmail: string): Promise<void> {
  // Dar terminal veya CI ortamında animasyonu atla
  const cols = process.stdout.columns ?? 80;
  if (!process.stdout.isTTY || cols < 40) return;

  return new Promise((resolve) => {
    const TOP = 1;
    const LEFT = 0;

    hideCursor();
    process.stdout.write('\x1B[2J\x1B[H');

    let phase: 'letters' | 'snake' | 'done' = 'letters';
    let letterRow = 0;
    let snakeHead = 0;
    let tongueFrame = 0;

    function renderLetters(upTo: number) {
      for (let i = 0; i <= upTo && i < SETH_LINES.length; i++) {
        moveTo(TOP + i, LEFT);
        process.stdout.write(chalk.red.bold(SETH_LINES[i]!));
      }
    }

    function renderSnakeNode(nodeIdx: number, bodyPos: number) {
      if (nodeIdx < 0 || nodeIdx >= SNAKE_PATH.length) return;
      const node = SNAKE_PATH[nodeIdx]!;
      const isHead = bodyPos === 0;
      const charIdx = Math.min(
        Math.floor((bodyPos / SNAKE_VISIBLE) * SNAKE_BODY_CHARS.length),
        SNAKE_BODY_CHARS.length - 1,
      );
      const char = isHead ? HEAD_CHAR : SNAKE_BODY_CHARS[charIdx]!;
      const colored = node.depth === 'front' ? chalk.white.bold(char) : chalk.gray(char);
      moveTo(TOP + node.row, LEFT + node.col);
      process.stdout.write(colored);
      if (isHead) {
        moveTo(TOP + node.row, LEFT + node.col + 1);
        process.stdout.write(chalk.red(TONGUE_FRAMES[tongueFrame % TONGUE_FRAMES.length]!));
      }
    }

    const sigintHandler = () => { showCursor(); process.stdout.write('\x1B[2J\x1B[H'); process.exit(0); };
    process.once('SIGINT', sigintHandler);

    const interval = setInterval(() => {
      tongueFrame++;

      if (phase === 'letters') {
        renderLetters(letterRow);
        letterRow++;
        if (letterRow >= SETH_LINES.length) phase = 'snake';
        return;
      }

      if (phase === 'snake') {
        // front katmanı
        for (let i = 0; i < SNAKE_VISIBLE; i++) {
          const ni = snakeHead - i;
          if (ni >= 0 && SNAKE_PATH[ni]?.depth === 'front') renderSnakeNode(ni, i);
        }
        // harfleri yeniden çiz (behind'ı örter)
        for (let i = 0; i < SETH_LINES.length; i++) {
          moveTo(TOP + i, LEFT);
          process.stdout.write(chalk.red.bold(SETH_LINES[i]!));
        }
        // front tekrar üste
        for (let i = 0; i < SNAKE_VISIBLE; i++) {
          const ni = snakeHead - i;
          if (ni >= 0 && SNAKE_PATH[ni]?.depth === 'front') renderSnakeNode(ni, i);
        }

        snakeHead++;

        if (snakeHead >= SNAKE_PATH.length + SNAKE_VISIBLE) {
          phase = 'done';
          clearInterval(interval);

          // Subtitle
          moveTo(TOP + SETH_LINES.length + 1, LEFT);
          process.stdout.write(chalk.red.dim(SUBTITLE));

          setTimeout(() => {
            // Bilgi satırları
            const base = TOP + SETH_LINES.length + 3;
            moveTo(base,     LEFT); process.stdout.write(`\x1b[2;31m  v${VERSION}\x1b[0m`);
            moveTo(base + 1, LEFT); process.stdout.write(`\x1b[38;5;121m  👤 ${userEmail}\x1b[0m`); // Yeşil (Mat)
            moveTo(base + 2, LEFT); process.stdout.write(`\x1b[38;5;75m  ✦ ${provider}/${model}\x1b[0m`);
            moveTo(base + 3, LEFT); process.stdout.write(`\x1b[2;38;5;75m  ⌂ ${shortenPath(process.cwd())}\x1b[0m`);
            moveTo(base + 5, LEFT); process.stdout.write(`\x1b[2m  /yardım → komutlar  •  Ctrl+C → iptal  •  Ctrl+D → çıkış\x1b[0m`);
            // imleci bilgi satırlarının altına taşı
            moveTo(base + 7, 0);
            showCursor();

            setTimeout(() => {
            process.removeListener('SIGINT', sigintHandler);
            resolve();
          }, 1400);
          }, 400);
        }
      }
    }, 60);
  });
}

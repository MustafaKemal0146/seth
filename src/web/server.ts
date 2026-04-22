import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, type WebSocket as WS, type RawData } from 'ws';
import open from 'open';
import chalk from 'chalk';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { webUIController } from './controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function startWebServer(port = 4321) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  webUIController.setServer(wss);

  // Static dosyaları servis et (web/public klasöründen)
  const publicPath = join(__dirname, '..', '..', 'web', 'public');
  app.use(express.static(publicPath));

  wss.on('connection', (ws: WS) => {
    console.log(chalk.cyan('  🌐 Web UI bağlandı.'));

    ws.on('message', (message: RawData) => {
      try {
        const event = JSON.parse(message.toString());
        // Web'den gelen komutları/mesajları burada handle edeceğiz
        if (event.type === 'user_input') {
          console.log(chalk.cyan(`\n  [Web UI] > ${event.data}`));
          webUIController.handleWebInput(event.data);
        } else if (event.type === 'command') {
          console.log(chalk.magenta(`\n  [Web CMD] > ${event.data}`));
          webUIController.handleWebCommand(event.data);
        } else if (event.type === 'abort') {
          console.log(chalk.red(`\n  [Web UI] > ABORT REQUEST`));
          webUIController.handleWebAbort();
        } else if (event.type === 'get_models') {
          webUIController.handleGetModels(event.data);
        }
      } catch (err) {
        console.error('WebSocket mesaj hatası:', err);
      }
    });

    ws.on('close', () => {
      console.log(chalk.dim('  🌐 Web UI bağlantısı kesildi.'));
    });
  });

  return new Promise<void>((resolve, reject) => {
    server.listen(port, 'localhost', async () => {
      console.log(chalk.green(`\n  ✓ SETH Web Sunucusu çalışıyor: http://localhost:${port}`));
      try {
        await open(`http://localhost:${port}`);
      } catch {
        console.log(chalk.yellow(`  ⚠ Tarayıcı otomatik açılamadı. Lütfen şu adrese gidin: http://localhost:${port}`));
      }
      resolve();
    });
    server.on('error', (err) => {
      if ((err as any).code === 'EADDRINUSE') {
        console.log(chalk.yellow(`  ⚠ Port ${port} kullanımda, web sunucusu başlatılamadı.`));
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

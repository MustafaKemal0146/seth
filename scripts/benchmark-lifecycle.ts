import { startBackgroundCleanup } from '../src/lifecycle.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function run() {
  const tmpDir = path.join(os.tmpdir(), 'seth-benchmark-' + Date.now());
  await fs.mkdir(tmpDir, { recursive: true });

  console.log(`Creating 5000 dummy files in ${tmpDir}...`);
  const now = Date.now();
  const oldTime = now - 40 * 24 * 60 * 60 * 1000; // 40 days ago

  const createPromises = [];
  for (let i = 0; i < 5000; i++) {
    const file = path.join(tmpDir, `session-${i}.json`);
    createPromises.push(
      fs.writeFile(file, '{}')
        .then(() => {
          // make 50% of files old
          if (i % 2 === 0) {
            const date = new Date(oldTime);
            return fs.utimes(file, date, date);
          }
        })
    );
  }
  await Promise.all(createPromises);

  console.log('Running benchmark...');
  const start = performance.now();
  await startBackgroundCleanup(tmpDir);
  const end = performance.now();

  console.log(`Time taken: ${(end - start).toFixed(2)} ms`);

  // Verify
  const remaining = await fs.readdir(tmpDir);
  console.log(`Remaining files: ${remaining.length} (expected 2500)`);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
}

run().catch(console.error);

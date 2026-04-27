
## 2024-05-18 - JSON Parsing vs Regex in File Metadata Extraction
**Learning:** Loading huge local JSON files fully into memory with `readFileSync` and parsing them completely via `JSON.parse` just to get a few top-level metadata properties (`id`, `updatedAt`, etc.) creates massive, slow, memory-intensive operations (taking ~350ms for 50 large files).
**Action:** Reading only the first 1000 bytes and the last 500 bytes with `openSync`, `readSync`, and `closeSync` and matching specific keys via Regex drops extraction times for 50 files from ~350ms to ~3ms. Always fall back to `JSON.parse` if the regex misses to avoid breaking core functionality.
- Use `Promise.all()` to map over an array and execute asynchronous I/O operations (like `fs.promises.stat` or `fs.promises.unlink`) concurrently instead of using a sequential `for...of` loop with `await` on each iteration.
- For `startBackgroundCleanup` optimization, mapping the files and keeping track of variables like `deleted++` inside `Promise.all` async arrow function is perfectly safe since Javascript operates on a single-threaded event loop and we are correctly catching the async promise rejection.
- Concurrency reduces background execution time considerably on I/O heavy operations. A 5000-file benchmark simulated on this background cleanup operation yielded a speed increase from ~1106 ms to ~304 ms.
## Performance Learnings

- Refactoring sequential I/O (like `npx` version checks) to concurrent execution using `Promise.allSettled` can yield massive speedups. In `src/mcp/discovery.ts`, changing from a sequential loop to concurrent execution dropped execution time from ~19.5s to ~3.1s.

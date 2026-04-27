## Performance Learnings

- Refactoring sequential I/O (like `npx` version checks) to concurrent execution using `Promise.allSettled` can yield massive speedups. In `src/mcp/discovery.ts`, changing from a sequential loop to concurrent execution dropped execution time from ~19.5s to ~3.1s.

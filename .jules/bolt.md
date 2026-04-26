
## 2024-05-18 - JSON Parsing vs Regex in File Metadata Extraction
**Learning:** Loading huge local JSON files fully into memory with `readFileSync` and parsing them completely via `JSON.parse` just to get a few top-level metadata properties (`id`, `updatedAt`, etc.) creates massive, slow, memory-intensive operations (taking ~350ms for 50 large files).
**Action:** Reading only the first 1000 bytes and the last 500 bytes with `openSync`, `readSync`, and `closeSync` and matching specific keys via Regex drops extraction times for 50 files from ~350ms to ~3ms. Always fall back to `JSON.parse` if the regex misses to avoid breaking core functionality.

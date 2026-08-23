# Contributing to ResumeForge

Thanks for helping! Quick rules:

1. **Zero runtime dependencies** — if it needs `npm install`, it doesn't ship here.
2. Business logic goes in `js/core.js` as pure functions, with tests in `tests/core.test.js`.
3. Run tests before pushing (CI enforces it):

   ```bash
   node --test tests/*.test.js
   ```

4. Any new UI string must be added to **both** `locales/en.json` and `locales/pt-BR.json`.
5. Keep the single-column resume output — multi-column layouts break ATS parsers.

Bug reports with a failing test case get priority. 🚀

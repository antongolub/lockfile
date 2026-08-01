import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Real-world interop tests parse a whole fixture corpus inside a single case
    // — 173 published locks across the explicit census, some very large. The 5s
    // vitest default is too tight on slow CI runners (surfaced on Node 26), so
    // raise the ceiling. Fast tests are unaffected — this only lifts the cap;
    // genuine hangs still surface.
    //
    // Deliberately NOT raised further for the scraped-corpus audits, which run
    // thousands of files and take 25-40s: those carry their own explicit budget
    // at the test. Keep this global tight so a hang in any of the ~6300 fast
    // cases still surfaces quickly, and give a slow case its own number instead.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // html for humans, lcov for qlty, text for the CI log.
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'target/coverage',
      include: ['src/main/ts/**'],
      exclude: [
        'src/main/ts/**/types.ts',   // type-only — no runtime to cover
        'src/main/ts/**/*.d.ts',
        // subpath re-export barrels (public API surface, no logic)
        'src/main/ts/{modify,complete,optimize,registry,enrich}/index.ts',
      ],
    },
  },
})

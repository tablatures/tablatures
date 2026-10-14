# Testing

Read [docs/testing.md](docs/testing.md) before changing tests or diagnosing a test failure.

- Run the relevant unit tests and affected browser specs during development. Run the full regression suite once after integration, not after every edit.
- Put player timing, repeat ranges, state transitions and boundary matrices in unit tests. Keep browser coverage for actual audio, rendering, gestures, persistence and navigation integration.
- Use `pnpm test:e2e <spec>` so each invocation gets its own port and artifacts. Do not reuse or kill another agent's server. Do not overlap builds or `pnpm check` (which runs `svelte-kit sync`) with browser runs in the same checkout; they share generated output. Use separate worktrees when needed.
- Inspect the first failure's trace before editing. Reproduce the affected test without retries; a single passing rerun does not establish flakiness.
- Do not fix failures by loosening musical expectations, adding sleeps/retries, or skipping when expected UI is missing. Fix the demonstrated cause and preserve the regression assertion.
- After a timing/harness fix, repeat the affected specs with `pnpm test:stability <spec>`; do not repeat unrelated suites without new evidence.

# alphaTab

Read [docs/alphatab-workarounds.md](docs/alphatab-workarounds.md) before upgrading alphaTab or adding code that depends on its internals. Prefer its public API; every workaround for alphaTab's own behaviour is version-gated in `src/library/utils/alphaTabWorkarounds.ts` and checked by a canary test.

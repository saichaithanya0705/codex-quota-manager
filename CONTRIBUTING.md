# Contributing

## Development Setup

Requirements:

- Node.js 20 or later
- npm 10 or later

Install dependencies:

```bash
npm ci
```

Run the app locally:

```bash
npm run dev
```

Run the checks:

```bash
npm run build
npm test
npm pack --dry-run
```

## Contribution Rules

- Keep fixes permanent. Do not submit workaround-only patches when the root cause can be fixed cleanly.
- Preserve cross-platform behavior for Windows, macOS, and Linux.
- Add or update tests when behavior changes.
- Keep changes focused. Large refactors are fine when they remove structural problems, but they should remain coherent and reviewable.

## Pull Requests

Before opening a pull request:

1. Rebase onto the latest `main`.
2. Run build, tests, and `npm pack --dry-run`.
3. Update README if user-facing behavior changes.
4. Explain the problem, the fix, and any tradeoffs.

## Release Process

1. Update `package.json` version.
2. Ensure CI is green on `main`.
3. Create and push a tag like `v0.1.0`.
4. Let the GitHub release workflow create the release artifacts.
5. Let the npm publish workflow publish the matching version, or publish manually if needed.

# Codex Quota Manager

Cross-platform Node TUI for managing multiple Codex accounts, switching the active account, and checking quota usage.

This project is designed to work on Windows, macOS, and Linux. iOS is not a first-class target, but the CLI should work anywhere a compatible Node runtime and terminal are available.

## Features

- Load accounts from managed app storage, Codex auth, and OpenCode auth
- Merge duplicate identities across sources into one canonical account row
- Check quota usage from the OpenAI usage endpoint
- Refresh expired access tokens with stored refresh tokens
- Add accounts through browser OAuth
- Apply an account to Codex, OpenCode, or both
- Preserve discovered accounts in the app-managed store

## Install

```bash
npm install
```

Global install:

```bash
npm install -g codex-quota-manager
```

## Run

Development:

```bash
npm run dev
```

Build and run:

```bash
npm run build
npm start
```

## Test

```bash
npm test
```

## Package Layout

- `src/`: TypeScript source for the CLI, auth, quota logic, and TUI
- `test/`: Vitest coverage for paths, token parsing, quota mapping, and store behavior
- `.github/workflows/`: CI, GitHub release, and npm publish automation
- `dist/`: generated build output used for the published CLI package

## Publishing

The package is structured for npm publication and GitHub-based releases:

- Push a semver tag such as `v0.1.0` to trigger the GitHub release workflow.
- The release workflow builds, tests, creates an npm tarball, and uploads it to the GitHub release.
- Publishing the GitHub release triggers the npm publish workflow.
- The npm workflow supports either trusted publishing via GitHub OIDC or a repository secret named `NPM_TOKEN`.

Recommended setup:

1. Create the GitHub repository at `saichaithanya0705/codex-quota-manager`.
2. Add the repository as the project remote.
3. For the first automated publish, either:
   - configure an npm granular token as the `NPM_TOKEN` repository secret, or
   - configure npm trusted publishing for `.github/workflows/publish-npm.yml` once the package exists.
4. After trusted publishing is working, prefer it over long-lived tokens.

## Community Files

- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)

## Keybindings

- `Up/Down` or `j/k`: move selection
- `Enter`: open action menu
- `r`: refresh selected account usage
- `R`: refresh all account usage
- `t`: refresh selected account token
- `a`: apply selected account to Codex
- `o`: apply selected account to OpenCode
- `b`: apply selected account to both
- `n`: add account through browser login
- `x`: delete managed copy of selected account
- `?`: toggle help
- `Esc`: close dialog or quit
- `q` / `Ctrl+C`: quit

## Paths

Codex auth:

- `CODEX_AUTH_PATH`
- `CODEX_HOME/auth.json`
- `~/.codex/auth.json`

OpenCode auth:

- `OPENCODE_AUTH_PATH`
- `OPENCODE_DATA_DIR/auth.json`
- Windows: `%LOCALAPPDATA%\\opencode\\auth.json`, `%APPDATA%\\opencode\\auth.json`
- Linux/macOS: `~/.local/share/opencode/auth.json`, `~/.config/opencode/auth.json`
- macOS: `~/Library/Application Support/opencode/auth.json`
- Fallback: `~/.opencode/auth.json`

Managed app store:

- `CQM_CONFIG_DIR`
- `CQ_CONFIG_HOME`
- Windows: `%APPDATA%\\codex-quota-manager`
- macOS: `~/Library/Application Support/codex-quota-manager`
- Linux: `$XDG_CONFIG_HOME/codex-quota-manager` or `~/.config/codex-quota-manager`

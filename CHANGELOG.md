# Changelog

All notable changes to this project are documented here.

## [0.1.2] - 2026-03-25

- Reworked the TUI layout to use a lighter status strip and a one-line help hint instead of the broken shortcuts footer
- Added `h` as the primary shortcuts/help toggle while keeping `?` as a compatibility alias
- Simplified account row state rendering to show `NOT FETCHED`, `ERROR`, or live quota data without mixed status text
- Added quota transport diagnostics for timeout and network failures so the UI no longer collapses errors into `fetch failed`
- Added formatter and quota tests covering the new help text and error handling behavior

## [0.1.1] - 2026-03-25

- Updated README usage instructions for source, global npm install, `npx`, and GitHub Packages
- Added GitHub Packages publish automation for the scoped mirror package `@saichaithanya0705/codex-quota-manager`
- Kept release automation aligned with tagged package versions

## [0.1.0] - 2026-03-25

- Initial public release
- Cross-platform Node TUI for Codex account switching and quota checks
- npm publication as `codex-quota-manager`

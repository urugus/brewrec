# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-03-01

### Added
- Migrated GUI runtime to HonoX + Vite (`app/` routes, islands, and server entry).
- Added shared UI API app (`createUiApiApp`) for unified API behavior between CLI-launched UI and HonoX server.
- Added dedicated recipe payload validator module (`src/ui/recipe-validator.ts`).
- Added `tsconfig.app.json` and app-side TypeScript checks in `npm run lint`.

### Changed
- Switched UI build pipeline to generate and serve `dist-ui/` bundles.
- Updated UI server bootstrap to load built UI app directly from `dist-ui/index.js`.
- Stabilized project root resolution in bundled UI runtime via `BROWREC_PROJECT_ROOT` override.
- Hardened Vite `process.env` handling (safe client define + server runtime env access).

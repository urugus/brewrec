# Repository Guidelines

## Project Structure & Module Organization
Core TypeScript code lives in `src/`. Command entry points are in `src/commands/` (`record`, `compile`, `run`, `debug`, `repair`), reusable logic is in `src/core/`, and the local management UI server is in `src/ui/`.  
Tests are in `test/` and should mirror core modules (example: `test/step-validation.test.ts` for `src/core/step-validation.ts`).  
Runtime data directories are:
- `recordings/`: raw browser traces and HTML snapshots
- `recipes/`: compiled `*.recipe.json` files
- `artifacts/`: run/debug outputs
- `public/`: static UI assets

## Build, Test, and Development Commands
- `npm install`: install dependencies and Playwright Chromium
- `npm run dev`: run the CLI directly from TypeScript (`tsx src/index.ts`)
- `npm run lint`: Biome checks + TypeScript type check (`tsc --noEmit`)
- `npm run test`: run unit tests with Vitest
- `npm run test:watch`: run Vitest in watch mode
- `npm run build`: compile to `dist/` with `tsc`

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npm run test`, and `npm run build` on Node 20; keep local results aligned before opening a PR.

## Coding Style & Naming Conventions
Use TypeScript (ESM) with 2-space indentation and semicolons, following Biome defaults (`biome.json`).  
Run `npm run format` before large edits.  
File naming uses kebab-case for modules (for example, `compile-heuristic.ts`), and command files map to CLI verbs (`src/commands/run.ts`).  
Prefer explicit, small functions in `src/core/` and keep command handlers focused on orchestration.

## Testing Guidelines
Framework: Vitest (`vitest.config.ts`).  
Place tests under `test/` with `*.test.ts` suffix.  
Name tests by behavior (for example, `"promotes API calls to http mode"`).  
Add or update tests for any change in recipe compilation, guard/effect validation, or replay behavior.

## Commit & Pull Request Guidelines
Recent history uses short, imperative subjects (examples: `Fix CI by tracking package-lock.json`, `Fix HTTP guard context to use page URL`).  
Recommended format: `<Scope>: <imperative summary>` or concise `Fix ...` when scope is obvious.  
PRs should include:
- What changed and why
- How to verify (`npm run lint && npm run test && npm run build`)
- Linked issue/context
- Screenshots or logs when UI/CLI behavior changes

## Security & Configuration Tips
Do not commit secrets, session data, or private recordings.  
Review generated files in `recordings/`, `recipes/`, and `artifacts/` before sharing; they may contain sensitive URLs, form inputs, or response payloads.

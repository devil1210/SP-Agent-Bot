<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **SPbot** (144 symbols, 209 relationships, 3 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/SPbot/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

<!-- gitnexus:end -->

# Development Guidelines

## Build, Lint, and Test Commands

*   **Build Project:** `npm run build`
*   **Run Development (Watch Mode):** `npm run dev`
*   **Start Application:** `npm start`
*   **Run Tests:** Check `package.json` for test scripts. Currently, no explicit `test` script defined.
*   **Run Single Test:** Ensure a test framework is set up (e.g., `vitest` or `jest`). If using `tsx`, run: `npx tsx path/to/test.ts` (if the file is executable directly).

## Code Style & Conventions

*   **Language:** TypeScript (ESM, `type: "module"`).
*   **Imports:** Use absolute paths (e.g., `@/db/...`) or relative paths (`../db/...`) as per project existing patterns.
*   **Formatting:** Follow existing indentation (2 spaces) and style.
*   **Types:** Strict typing. Avoid `any` when possible.
*   **Naming Conventions:**
    *   Variables/Functions: `camelCase`.
    *   Types/Interfaces: `PascalCase`.
*   **Error Handling:** Use `try/catch` blocks in asynchronous operations, particularly for network requests, database interactions, and LLM calls. Log errors clearly using `console.error` with context identifiers (e.g., `[Agent Loop Error]`).
*   **Database:** Use `@supabase/supabase-js`. Follow existing patterns in `src/db/`.
*   **Agent Loop:**
    *   Keep iteration limit (`MAX_ITERATIONS`).
    *   Use `cleanResponse` and `extractFinalResponse` from `src/utils/cleanResponse.ts` before processing LLM outputs.
    *   Sanitize Telegram output via `sanitizeTelegramHTML`.
*   **Adding New Features/Tools:**
    *   Define tools in `src/tools/`.
    *   Add to `getToolsDefinition` in `src/tools/index.ts`.
    *   Implement execution logic in `executeTool`.

## Project Structure
- `src/`: Core logic.
    - `agent/`: Bot logic, loops, LLM interaction.
    - `db/`: Database operations and settings management.
    - `tools/`: Tool definitions and implementation.
    - `utils/`: Helper functions.
- `dist/`: Compiled output.

## Security
- NEVER commit secrets (`.env`, `botconfig.local.json`, credentials) to the repository.
- Use environment variables via `dotenv` for sensitive configuration.

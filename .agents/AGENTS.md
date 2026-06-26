# Project rules for SP-Agent-Bot

## Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from Andrej Karpathy's observations on LLM coding pitfalls.

### 1. Think Before Coding
- **Don't assume. Don't hide confusion. Surface tradeoffs.**
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them.
- If a simpler approach exists, propose it. Push back on overcomplication.
- If something is unclear, stop and ask.

### 2. Simplicity First
- **Minimum code that solves the problem. Nothing speculative.**
- Do not build features beyond what was asked.
- Avoid abstractions for single-use code.
- Avoid "flexibility" or "configurability" that wasn't requested.
- Avoid error handling for impossible scenarios.
- Keep implementations as concise as possible.

### 3. Surgical Changes
- **Touch only what you must. Clean up only your own mess.**
- Do not "improve" adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match the existing codebase style exactly.
- Remove imports, variables, or functions that your changes made unused.
- Do not remove pre-existing dead code unless asked.

### 4. Goal-Driven Execution
- **Define success criteria. Loop until verified.**
- Transform tasks into verifiable goals (e.g., writing a reproducing test or checking specific command exit codes).
- For multi-step tasks, state a brief plan with verification steps.

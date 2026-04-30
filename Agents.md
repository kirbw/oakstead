# AGENTS.md

This file defines repository-level instructions for coding agents working in this project.

## Scope
These instructions apply to the entire repository unless a deeper/nested `AGENTS.md` overrides them.

## Core workflow
1. Understand the request and inspect relevant files first.
2. Prefer minimal, focused changes over broad refactors.
3. Keep edits consistent with existing patterns and naming.
4. Run the smallest useful validation commands when allowed.
5. Summarize:
   - what changed,
   - why it changed,
   - what was validated,
   - any limitations or follow-up items.

## Safety and change discipline
- Do not modify unrelated files.
- Do not add dependencies unless explicitly requested.
- Avoid destructive commands (e.g. force resets, deleting user data) unless explicitly approved.
- If requirements are ambiguous, ask clarifying questions before large changes.

## Tooling preferences
- Use fast search tools (`rg`, targeted file reads).
- Avoid expensive repo-wide scans unless necessary.
- Prefer existing scripts/configs in the repo over ad-hoc alternatives.

## Browser and screenshot support
When UI/UX or frontend behavior is changed (styles, layout, component behavior, flows):
1. Use a tool like Playwright or Browser Container (if available) to open and verify the changed view.
2. Take at least one screenshot showing the updated state.
3. Include screenshot artifact links in the final response using markdown image syntax:
   - `![description](<artifact_path>)`
4. If these tools are unavailable or fail:
   - explicitly say it was attempted,
   - describe why screenshots could not be captured,
   - provide manual verification steps.

## QA / validation guidance
- Prefer targeted checks first (lint/test for touched area).
- If full test suite is too heavy, run relevant subset and state what was/wasn’t run.
- Report failures with probable cause and next actions.

## Output expectations
- Be concise and actionable.
- Include file paths for important changes.
- Provide clear reproduction/verification steps when relevant.
- Call out assumptions and environment limitations.

## Optional PR guidance
If preparing a PR summary, include:
- **Title:** concise, user-visible outcome.
- **Summary:** key changes and motivation.
- **Validation:** commands run + outcomes.
- **Risks/Follow-ups:** known gaps or future improvements.

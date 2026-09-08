# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

GoLinks is a TypeScript short-link service: members type `go/<keyword>` and are redirected to a destination URL scoped to their organization. The project is in the specification stage and has no application code yet.

Read `docs/specs/00-overview.md` first. The numbered specs under `docs/specs/` are the source of truth for behavior. `docs/decisions/` holds architecture decision records; ADR 0001 (application framework) is still pending and determines the repository layout, so do not scaffold code until it is decided.

## Conventions

- Documentation describes this product on its own terms. Do not compare it to, or reference, other go-link products.
- Naming follows the specs' vocabulary: keyword, namespace, resolution, transfer, short host, canonical host. Invent module and function names from that vocabulary rather than borrowing from elsewhere.
- UX flows are intentionally left out of `docs/specs/08-web-app-features.md`. Stop and discuss with the user before designing screens, flows, or navigation.
- Work is tracked with beads (`bd`). Once the framework is decided, the specs are broken down into beads epics and tasks before implementation starts.
- Application routes live under `/_/`; every other path is a potential keyword. Keep it that way when adding routes.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

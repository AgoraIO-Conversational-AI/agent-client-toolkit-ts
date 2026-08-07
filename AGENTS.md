# AI Agent Instructions

This repository uses progressive disclosure documentation. Docs live under
`docs/ai/` in three levels.

## How to Load

1. Read [docs/ai/L0_repo_card.md](docs/ai/L0_repo_card.md) to identify the repo.
2. Load ALL 8 files in `docs/ai/L1/`. They are small — load all upfront.
3. Follow L2 deep-dive links only when L1 isn't detailed enough.

## Git Conventions

### Commit messages — conventional commits

- **Format:** `type: description` or `type(scope): description`
- **Types:** `feat:` (new feature), `fix:` (bug fix), `chore:` (maintenance, version bumps), `test:` (test additions/changes), `docs:` (documentation)
- **Scoped variant:** `feat(scope):`, `fix(scope):` — e.g. `feat(auth): add token refresh`
- **Lowercase after prefix** — `feat: add feature`, not `feat: Add feature`
- **Present tense** — "add feature", not "added feature"

### Branch names

- **Format:** `type/short-description` — lowercase, hyphen-separated
- **Types match commit types:** `feat/`, `fix/`, `chore/`, `test/`, `docs/`
- **Examples:** `feat/token-refresh`, `fix/null-pointer`, `docs/progressive-disclosure`

### General rules

- **No AI tool names** — never mention claude, cursor, copilot, cody, aider, gemini, codex, chatgpt, or gpt-3/4
- **No Co-Authored-By trailers** — omit AI attribution lines
- **No --no-verify** — let git hooks run normally
- **No git config changes** — do not modify user.name or user.email

## Doc Commands

| Command       | When to use                                   |
| ------------- | --------------------------------------------- |
| generate docs | no `docs/ai/` directory exists yet            |
| update docs   | code changed since last `last_reviewed` date  |
| test docs     | verify docs give agents the right context     |

# Security Policy

We take the security of Orion seriously. Thank you for helping keep the project
and its users safe.

## Supported versions

Orion is under active development and has not yet reached a stable `1.0` release.
Security fixes are applied to the latest `main` branch. We recommend always
running the most recent release.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < latest | :x:               |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report them privately using GitHub's
[private security advisory](https://github.com/aavanzyl/orion/security/advisories/new)
form. This keeps the details confidential until a fix is available.

Please include as much of the following as possible:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof-of-concept.
- The affected component (orchestrator, web, db, adapters, config).
- Any known mitigations or workarounds.

## What to expect

- **Acknowledgement** within 3 business days.
- **An assessment** and severity rating within 10 business days.
- **Coordinated disclosure**: we will work with you on a fix and a disclosure
  timeline, and credit you in the advisory unless you prefer to remain anonymous.

## Scope and handling secrets

Orion orchestrates autonomous coding agents and integrates with third-party
providers (AI harnesses, source control, boards, chat). Keep the following in
mind:

- **Never** paste API keys, tokens, or other credentials into issues, PRs, or
  logs. Redact secrets before sharing reproduction steps.
- Configuration such as `.env` is git-ignored by default. Use `.env.example` as
  the template and keep real credentials out of version control.
- Agents execute in isolated, disposable git worktrees. Report any behavior that
  allows an agent or workflow to escape that isolation or access unintended
  resources.

Thank you for practicing responsible disclosure.

# Claude continuation guide

This repository is the canonical source for the Steve Rother / Espavo Gmail-to-Telegram automation.

## Start here

Read these files completely, in this order:

1. `AGENTS.md` — non-negotiable safety and testing rules.
2. `HANDOVER.md` — architecture, deployment state, private/runtime components, and next steps.
3. `README.md` — normal operating and testing workflow.
4. `Code.gs`, `Index.html`, `appsscript.json`, and `tests.js` — implementation.

## Important boundaries

- GitHub contains the complete application source, tests, manifest, documentation, and deployment workflow.
- GitHub intentionally does **not** contain API keys, bot tokens, private Telegram IDs, Gmail message IDs/bodies, Apps Script properties, OAuth credentials, or runtime journals.
- Those private values already live in Google Apps Script Script Properties or encrypted GitHub Actions secrets.
- Never ask the owner to paste secrets into chat, source code, issues, commits, or logs.
- A push to `main` that changes Apps Script source triggers `.github/workflows/deploy-apps-script.yml`, which deploys the existing private web app.
- Documentation-only changes do not deploy the Apps Script app.
- Do not enable live mode, install the production trigger, or perform any Telegram publication without the owner's explicit approval at that action gate.

## Required checks

Before committing source changes, run:

```bash
node --check < Code.gs
node tests.js
```

For `Index.html` changes, also validate the inline JavaScript and visually inspect both desktop and narrow/mobile layouts after deployment.

## Current operating intent

- Cloud host: Google Apps Script.
- Schedule when eventually enabled: once daily, around 9am Europe/London.
- Source mailbox: the owner's Gmail Inbox only.
- Strict newsletter sender: `mailmanager@espavo.org`, plus independent bulk-newsletter header checks.
- Rewrite provider: Gemini.
- Destination: Telegram via `@steve_newsletter_bot`.
- Present state: safe test mode; controlled production publication, duplicate verification, and trigger installation remain explicit gates.

When making a material change, update `HANDOVER.md` in the same commit.

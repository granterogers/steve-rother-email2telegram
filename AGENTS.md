# Agent instructions

Read `README.md` and `HANDOVER.md` before changing this project.

## Non-negotiable constraints

- Keep the solution on Google Apps Script and free-tier services unless the owner explicitly changes that decision.
- Never commit API keys, bot tokens, numeric private chat IDs, Gmail bodies, stored dry-run output, or Script Properties.
- Do not broaden newsletter matching. Preserve the strict sender and independent-header checks.
- Never mark Gmail processed before Telegram has confirmed every required message.
- Preserve locks, bounded retry/backoff, publication journals, and duplicate protection.
- Keep dry-run mode non-publishing and non-mutating.
- Keep test-group publication separate from production processing; it must never label Gmail.
- Do not enable `LIVE_MODE`, approve a Gmail item, publish to Telegram, or install the trigger without explicit owner approval at that gate.
- Preserve protected image and link markers through Gemini rewriting.
- Maintain owner-only web-app access unless the owner explicitly requests a permissions change.

## Required verification

Run before committing:

```bash
node --check < Code.gs
node tests.js
```

When dashboard HTML changes, verify both desktop and narrow/mobile rendering in the private web app after deployment. A saved Apps Script edit is not proof that the deployed `/exec` version changed.

Update `HANDOVER.md` whenever deployment state, test results, model, sender rules, Telegram destination type, live mode, or trigger state changes.

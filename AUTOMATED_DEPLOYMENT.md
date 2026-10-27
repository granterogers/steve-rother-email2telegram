# Automatic deployment

The repository contains `.github/workflows/deploy-apps-script.yml`. Once its three encrypted repository secrets are configured, every source change pushed to `main` is deployed to the existing private Apps Script web app automatically.

## One-time authorization boundary

Google requires the Apps Script owner's OAuth consent. Apps Script API deployments for a personal Gmail-owned project cannot use an ordinary service account. Complete one `clasp login`, then store the resulting credential JSON as the encrypted `CLASPRC_JSON` repository secret.

Required encrypted GitHub Actions secrets:

- `APPS_SCRIPT_ID`: the Apps Script project ID.
- `APPS_SCRIPT_DEPLOYMENT_ID`: the existing web-app deployment ID.
- `CLASPRC_JSON`: the complete contents of the authenticated clasp credential file.

The workflow writes credentials only to the runner's temporary filesystem with owner-only permissions and deletes them in an `always()` cleanup step. Neither credentials nor private Telegram/Gemini configuration enter the repository. Application secrets remain in Apps Script Properties.

If the secrets are absent, the workflow exits safely without attempting deployment. Once configured, use **Run workflow** once to deploy the current commit; later pushes deploy automatically.

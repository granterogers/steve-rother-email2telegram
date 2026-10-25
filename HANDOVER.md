# Full handover

Updated: 25 October 2026

## Outcome and current state

The implementation is a private Google Apps Script web app that runs in Google's cloud. It reads a narrowly identified Espavo newsletter from Gmail, extracts text/images/links, rewrites it with Gemini, and publishes it through the Telegram Bot API only after safety conditions pass.

The deployed Apps Script project already exists and its secrets remain in Script Properties. The repository intentionally contains no secrets and no stored newsletter body.

| Item | Current state |
| --- | --- |
| Apps Script project | Created and authenticated as the owner's Google account |
| Private dashboard | Version 5 deployed on 25 October 2026; access restricted to the owner |
| Gmail account | Connected through Apps Script authorization |
| Newsletter sender | `mailmanager@espavo.org` |
| Historical sample | Configured privately in `TEST_MESSAGE_ID` |
| Telegram bot | `@steve_newsletter_bot` |
| Telegram destination | Test group configured in Script Properties; numeric ID deliberately excluded from this public repository |
| Gemini | API key configured in Script Properties; value excluded from the repository |
| Historical dry run | Previously succeeded with six selected images; must be rerun after the link-preservation release |
| Test Telegram publication | Not yet performed for the current rich-message/link build |
| Controlled live publication | Not yet performed |
| Duplicate-prevention live check | Not yet performed |
| Live mode | Off at last verified state |
| Scheduled trigger | Off at last verified state |

The requested inbox-testing dashboard is deployed in Apps Script Version 5: **Scan my inbox**, strict newsletter results, one-or-many selection (maximum ten), multi-preview generation, individually signed previews, a separate customizable Telegram test destination, individual sends, and send-all testing. The existing `/exec` URL was visually verified to show these controls on 25 October 2026.

## Resources

- GitHub: <https://github.com/granterogers/steve-rother-email2telegram>
- The Apps Script project ID, editor URL, private web-app URL, Gmail account, Gmail message IDs, Telegram destination ID, and credentials are deliberately retained only in the owner's private Google configuration.

The web-app deployment URL may still serve an older version until a new Apps Script deployment is explicitly released. Saving editor code does not update an existing deployment automatically.

## Architecture

1. An hourly Apps Script trigger calls `scheduledRun` when enabled.
2. Gmail candidates come from a narrow sender query.
3. `isNewsletter_` requires the exact sender plus at least four independent bulk-newsletter signals (MailerLite headers, DKIM evidence, unsubscribe header, bulk precedence, multipart MIME, etc.).
4. The extractor removes boilerplate and trackers while retaining meaningful images and editorial links in source order.
5. Images and links become protected markers before the cleaned text is sent to Gemini.
6. Gemini rewrites within a bounded prompt/output budget.
7. Deterministic post-processing restores any missing marker and removes duplicate marker occurrences.
8. Telegram `sendRichMessage` is attempted first, producing interleaved paragraphs, images, and clickable links in one rich message.
9. If rich messages are rejected, the publisher falls back to ordered text/photo messages; link markers expand to labelled full URLs.
10. A per-Gmail-message journal stores every confirmed Telegram message ID and next position so retries resume safely.
11. Only after Telegram success is recorded does the workflow store `PROCESSED_<gmailMessageId>` and apply the Gmail label `Espavo/Telegram-Processed`.

## Safety model

- `LIVE_MODE=false` blocks scheduled publication.
- Dry-run TEST MODE calls Gemini but neither Telegram nor Gmail mutation.
- Dashboard test publication requires an explicit confirmation phrase and never marks Gmail processed.
- The first production publication requires `LIVE_APPROVED_MESSAGE_ID` to exactly match the approved Gmail item.
- A script lock prevents overlapping executions.
- Retry/backoff is bounded.
- Processing is idempotent through both the publication journal and processed record.
- Secrets are read only from Apps Script Script Properties.
- Logs avoid tokens and raw API responses. Dry-run output is intentionally visible for editorial review.

## Script Properties

Manage these under **Apps Script → Project Settings → Script properties** or through the private dashboard where supported.

| Property | Required value/state |
| --- | --- |
| `GEMINI_API_KEY` | Existing Gemini key; never commit it |
| `TELEGRAM_BOT_TOKEN` | Existing BotFather token; never commit it |
| `TELEGRAM_CHAT_ID` | Numeric test group/channel ID; never commit it in this public repository |
| `TEST_TELEGRAM_CHAT_ID` | Optional test-only group/channel ID; changing it does not alter production |
| `TEST_MESSAGE_ID` | The privately selected historical Gmail message ID |
| `LIVE_MODE` | Keep `false` until the controlled publication is approved |
| `LIVE_APPROVED_MESSAGE_ID` | Blank except during the one-item controlled release |
| `UI_CONFIG` | Dashboard-managed parsing and formatting settings |
| `LAST_TEST_RESULT` | Latest stored dry-run preview; contains newsletter-derived content and remains private |

## Exact continuation sequence

1. Ensure the Apps Script editor contains the repository versions of `Code.gs` and `Index.html`, and the manifest matches `appsscript.json`.
2. Create a new web-app deployment/version, keeping **Execute as: Me** and **Who has access: Only myself**.
3. Open the private dashboard and run **Validate connections**.
4. Click **Scan my inbox**, choose one or more verified newsletters, and click **Generate selected previews**. This sends only the selected newsletter content to the configured Gemini API; it does not contact Telegram or modify Gmail.
5. Confirm every preview displays real images, clickable event/source links, and no unresolved `[[IMAGE_n]]` or `[[LINK_n]]` placeholders.
6. Choose the **Telegram test destination** using discovery or a known group/channel ID. This setting is separate from production.
7. Send previews individually or use **Send all generated previews**. Confirm the messages in Telegram and verify Gmail remains unlabelled.
8. If approved for production, call `approveExactlyOneMessageForLivePublication('<approved Gmail message ID>')` using the private ID shown in the dashboard.
9. Run `runApprovedMessageOnce`. Confirm Telegram success, then confirm the Gmail processed label appears.
10. Run `runApprovedMessageOnce` again and verify the result is `duplicate_prevented` with no second Telegram publication.
11. Only after all checks pass, run `installHourlyTrigger`.

Steps 2, 4, 7, 8, 9, and 11 are deliberate authorization/publication gates and should not be automated past without the owner's explicit approval at the time.

## Dashboard behavior

- **Parsing & writing** edits sender/query boundaries, cleanup patterns, prompt, model, length, and image count.
- **Connections** stores keys in Script Properties, discovers Telegram groups, and validates Gmail/Gemini/Telegram configuration.
- **Test preview** scans the inbox using production-grade identification, supports selecting up to ten newsletters, and renders each final Telegram rich message—not placeholder tokens—including clickable hyperlinks and images.
- Each preview carries a server-generated signature; edited or stale payloads are refused by the test-send endpoint.
- A separate customizable test destination can be selected from groups/channels visible to the bot without changing the production destination.
- Individual and send-all test actions require in-page confirmation and never mark Gmail processed.

## Deployment notes

This project currently lives directly in Apps Script. The repository is the new canonical source. For repeatable synchronization, install Google's `clasp`, log in with the owning Google account, create a local `.clasp.json` containing the private project `scriptId`, and use `clasp push`. Never commit `.clasp.json`.

When deploying manually:

1. Open **Deploy → Manage deployments**.
2. Edit the web-app deployment.
3. Select **New version**.
4. Keep owner-only access and execute-as-owner unchanged.
5. Deploy and verify the existing `/exec` URL.

## Operations and troubleshooting

- Dashboard status cards show whether Gemini, Telegram, destination, live mode, and cloud schedule are ready.
- Apps Script **Executions** is the primary log location.
- `validateConfiguration()` checks current bot, destination, model, trigger, and safety state.
- If Telegram cannot fetch an external image URL, rich publication falls back only for recognized compatibility errors; other failures stop processing and leave Gmail unprocessed.
- If a Telegram sequence partially succeeds, rerun the same item. The journal resumes after the last confirmed message.
- If Gemini returns no content or reaches the output cap, nothing is published.
- If a newsletter fails strict identification, it is ignored or receives the error path rather than being broadly published.
- To stop all unattended activity, run `disableAutomation()`.

## Editing guide

- Rewrite style: dashboard **Rewrite instructions** or `CONFIG.rewritePrompt`.
- Parsing boundaries/removal patterns: dashboard **Parsing & writing**.
- Model: dashboard **Gemini model** or `CONFIG.model`.
- Formatting: `rewriteWithGemini_`, `buildTelegramRichHtml_`, and `Index.html` preview renderer.
- Link behavior: `htmlToImageAwareText_`, `ensureLinkMarkers_`, `richTextWithLinks_`, and `expandLinkMarkers_`.
- Image behavior: `newsletterImageFromTag_`, `ensureImageMarkers_`, and Telegram rich/fallback builders.
- Schedule: `CONFIG.triggerEveryMinutes` plus trigger reinstall.

## Verification already completed

Local checks completed successfully on 16 September 2026:

```text
node --check < Code.gs
node tests.js
All local helper tests passed.
```

Those tests cover boilerplate cleanup, labelled redirect preservation, useful-link metadata, image filtering and order, protected markers, rich Telegram HTML, ordered fallback, message chunking, trimming, tracking-URL classification, and digest stability.

## Known remaining work

- Test **Scan my inbox** and generate previews for one and several newsletters. The button is deployed, but no inbox scan has yet been run against Version 5.
- Verify the rich-message preview visually in the deployed dashboard.
- Choose a test-only Telegram destination and inspect both individual and send-all rendering.
- Perform the one-item controlled production test only after editorial approval.
- Verify duplicate prevention with a second run.
- Install the hourly trigger only after the controlled publication passes.

Until those items are complete, the system should remain in TEST MODE with no production trigger.

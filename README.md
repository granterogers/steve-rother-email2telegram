# Steve Rother / Espavo Gmail-to-Telegram automation

An unattended, effectively zero-cost Google Apps Script workflow for:

`Gmail -> strict Espavo newsletter validation -> text/image cleanup -> Gemini rewrite -> Telegram rich post -> processed label`

The production path is fail-closed. `LIVE_MODE` must be `true`; the controlled first publication also requires an exact Gmail message ID in `LIVE_APPROVED_MESSAGE_ID`. Dry-run TEST MODE never calls Telegram and never modifies Gmail. A separate dashboard button can publish the saved preview to the configured test group, but it still never labels or modifies Gmail.

## Repository contents

| File | Purpose |
| --- | --- |
| `Code.gs` | Gmail matching, extraction, Gemini rewrite, Telegram publication, locks, retries, journals, labels, and dashboard API |
| `Index.html` | Private Apps Script dashboard for parsing settings, inbox scanning, multi-select dry runs, final rich-message previews, destination selection, and test publication |
| `appsscript.json` | Apps Script runtime, timezone, and OAuth scopes |
| `tests.js` | Local tests for cleaning, image/link preservation, rich HTML, fallback ordering, chunking, and idempotency helpers |
| `HANDOVER.md` | Current deployment state, exact continuation plan, safety gates, and maintenance notes |
| `AGENTS.md` | Guardrails for future implementation agents |

## Required Script Properties

Add these in **Project Settings -> Script properties**. Never paste their values into `Code.gs`.

| Property | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `TELEGRAM_BOT_TOKEN` | Telegram token issued by BotFather |
| `TELEGRAM_CHAT_ID` | Numeric group/channel ID or public `@channelusername` |
| `TEST_MESSAGE_ID` | Historical Gmail message used for the dry run |
| `LIVE_MODE` | Start as `false` |
| `LIVE_APPROVED_MESSAGE_ID` | Leave blank until Grant approves the exact test output |

Set `TEST_MESSAGE_ID` privately to the Gmail message selected for dry-run testing. Do not commit Gmail message IDs or newsletter content to this public repository.

## Safe sequence

1. Open the private dashboard and save the Gemini key and Telegram bot token. Keep `LIVE_MODE=false` and no approved message ID.
2. Validate the connections, then open **Test preview** and click **Scan my inbox**.
3. Select one or more strictly verified newsletters and click **Generate selected previews**. Up to ten can be tested together.
4. Compare a sandboxed rendering of the real newsletter HTML with the Telegram result side by side. The source pane retains the email's colours, spacing, headings, images and styled CTA buttons while disabling links and removing tracking pixels. Edit the Telegram wording/spacing, move images earlier or later, or remove images; the live preview updates immediately. This does not publish or label Gmail.
5. Choose a separate **Telegram test destination**. Use **Discover Telegram destinations** to select any group or channel visible to the bot.
6. Send one preview individually or click **Send all generated previews** and accept the explicit confirmation. Test publication never marks Gmail processed and does not alter the production destination.
7. Only after editorial approval, run `approveExactlyOneMessageForLivePublication('MESSAGE_ID')`.
8. Run `runApprovedMessageOnce` once.
9. Run it again; the result must be `duplicate_prevented` and Telegram must receive nothing new.
10. Run `installHourlyTrigger` only after the controlled live test passes. (The legacy function name is retained for compatibility; it now installs a once-daily trigger.)

## Inbox testing workflow

`scanInboxForNewsletters()` restricts the configured Gmail query to the active Inbox (`in:inbox -in:trash -in:spam`) and then applies the same strict header validation used by production. Archived, Spam, and Trash messages are excluded. The dashboard returns only subject, sender, date, processed state, and private Gmail identifiers needed for the test session; it does not expose message bodies during scanning.

Selected newsletters are rewritten only when **Generate selected previews** is clicked. Each returned preview is signed by the server. The test-send endpoint rejects a preview if its text, images, links, or Gmail identifier have changed after generation.

Intentional dashboard edits use a separate server-side re-signing step that first validates the original preview, then signs the exact edited text and image list. This preserves the anti-tampering check while allowing editorial changes.

`TEST_TELEGRAM_CHAT_ID` stores the optional test-only destination. It defaults to the production destination when unset, but changing it never changes `TELEGRAM_CHAT_ID`. The dashboard resolves the numeric ID through Telegram and displays the group/channel name and type beside it.

## Disable

Run `disableAutomation`. It removes production triggers and resets `LIVE_MODE=false`.

## Matching and duplicate safety

The Gmail query is narrowed to `mailmanager@espavo.org`, then each candidate must pass at least four independent bulk-newsletter checks: exact From address, MailerLite `Message-ID`, bulk precedence, unsubscribe header, MailerLite feedback header, `espavo.org` DKIM evidence, and multipart/alternative MIME. Personal messages from `steve@espavo.org` cannot pass.

Meaningful remote newsletter images are retained in source order. Tracking pixels, social icons, logos, spacers, duplicate URLs, undersized layout graphics, MailerLite/mlsend redirects, unsubscribe links, and other boilerplate destinations are removed. Direct useful editorial links are represented by protected `[[LINK_n]]` markers before Gemini sees the content. Images use protected `[[IMAGE_n]]` markers. Missing markers are repaired deterministically, and a trailing image pile-up is redistributed across the rewritten paragraphs. The dashboard resolves both marker types into real images and clickable links. Preview progress distinguishes the fast local parse from the hosted Gemini rewrite and reports elapsed time.

The live path first uses Telegram `sendRichMessage` so paragraphs and images appear as one interleaved post. If the destination rejects rich messages, it falls back to consecutive text and photo messages in the same order. After every confirmed Telegram message, a private publication journal stores its Telegram message ID and next item index. Retries resume after the last confirmed item. A separate processed record is then written and the Gmail thread is labelled `Espavo/Telegram-Processed`. Gmail is never labelled before Telegram confirms success.

## Editing

- Rewrite tone/format: edit `CONFIG.rewritePrompt`.
- AI model: edit `CONFIG.model`.
- Schedule: once daily, around 9am London time. Reinstall the trigger after changing the schedule in `installHourlyTrigger`.
- Telegram length: edit `CONFIG.maxTelegramChars` (keep below Telegram's 4096-character limit).
- Image limit: edit `CONFIG.maxNewsletterImages` (1-10; default 8).

## Logs and caveats

Execution history is in **Apps Script -> Executions**. Logs intentionally omit tokens, raw API responses, and newsletter source text; TEST MODE logs the proposed post because it is explicitly for editorial review.

Google Apps Script and the Gemini API currently provide free capacity far above this workflow's expected one message every 1-3 weeks, but quotas and model availability can change. Gemini free-tier prompts may be used by Google to improve its products. Recheck the model and free-tier terms periodically. Telegram bot tokens do not normally expire automatically, but revoking the token, removing the bot, or changing channel permissions will stop publication.

## Local verification

```bash
node --check < Code.gs
node tests.js
```

Expected result: `All local helper tests passed.`

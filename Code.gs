/**
 * Espavo Gmail -> Gemini -> Telegram automation.
 * Secrets belong in Apps Script Project Settings > Script properties.
 */

const CONFIG = Object.freeze({
  sender: 'mailmanager@espavo.org',
  testMessageId: '',
  processedLabel: 'Espavo/Telegram-Processed',
  errorLabel: 'Espavo/Telegram-Error',
  gmailQuery: 'from:mailmanager@espavo.org newer_than:180d -in:spam -in:trash',
  model: 'gemini-3.6-flash',
  maxSourceChars: 30000,
  maxTelegramChars: 3800,
  maxNewsletterImages: 8,
  maxNewsletterLinks: 30,
  triggerEveryMinutes: 60,
  maxRetries: 3,
  rewritePrompt: [
    'Rewrite this Espavo newsletter as one warm, clear Telegram post for Steve Rother\'s community.',
    'Preserve the central teaching, factual dates, event details, speaker names, and any useful non-tracking original link.',
    'Preserve every useful event, registration, video, course, and source hyperlink supplied in the cleaned newsletter. Put the descriptive link text immediately before its complete URL; never invent or shorten a URL.',
    'Remove email boilerplate, tracking language, unsubscribe text, repeated navigation, sales clutter, and duplicate passages.',
    'Use a compelling short title, 2-5 brief paragraphs, and at most 5 concise bullet points only when they improve clarity.',
    'Write in accessible English for both existing followers and newcomers. Keep Steve\'s spiritual tone without inventing claims.',
    'End with a gentle invitation or the most relevant non-tracking source link when present. If none remains, do not invent a URL.',
    'Do not mention that AI rewrote the text. Output plain text only, no Markdown tables and no HTML.',
    'Hard limit: 3400 characters.'
  ].join('\n')
});

const PROP = Object.freeze({
  geminiKey: 'GEMINI_API_KEY',
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  telegramChatId: 'TELEGRAM_CHAT_ID',
  testTelegramChatId: 'TEST_TELEGRAM_CHAT_ID',
  testMessageId: 'TEST_MESSAGE_ID',
  liveMode: 'LIVE_MODE',
  approvedMessageId: 'LIVE_APPROVED_MESSAGE_ID',
  lastTestResult: 'LAST_TEST_RESULT'
});

function scheduledRun() {
  return runAutomation_({ testMode: false });
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Espavo Newsletter Automation')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function getDashboardState() {
  const props = PropertiesService.getScriptProperties();
  const settings = getSettings_();
  const last = parseJson_(props.getProperty(PROP.lastTestResult));
  return {
    settings: settings,
    status: {
      account: Session.getEffectiveUser().getEmail(),
      geminiConfigured: Boolean(props.getProperty(PROP.geminiKey)),
      telegramConfigured: Boolean(props.getProperty(PROP.telegramToken)),
      destinationConfigured: Boolean(props.getProperty(PROP.telegramChatId)),
      liveMode: props.getProperty(PROP.liveMode) === 'true',
      triggerInstalled: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'scheduledRun'),
      liveReason: props.getProperty(PROP.liveMode) === 'true'
        ? 'Enabled for approved production publishing.'
        : 'Safely off until a preview is approved for the first controlled live publication.',
      scheduleReason: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'scheduledRun')
        ? 'Cloud trigger installed and running automatically.'
        : 'Not installed yet. It stays off until the controlled live test and duplicate check pass.',
      lastTestAt: last ? last.testedAt : '',
      lastTestSubject: last ? last.subject : ''
    },
    lastTest: last || null
  };
}

function saveDashboardSettings(input) {
  const props = PropertiesService.getScriptProperties();
  const clean = sanitizeSettings_(input || {});
  props.setProperty('UI_CONFIG', JSON.stringify(clean));
  if (clean.testMessageId) props.setProperty(PROP.testMessageId, clean.testMessageId);
  if (clean.telegramChatId) props.setProperty(PROP.telegramChatId, clean.telegramChatId);
  if (clean.testTelegramChatId) props.setProperty(PROP.testTelegramChatId, clean.testTelegramChatId);
  return getDashboardState();
}

function saveDashboardSecrets(input) {
  const props = PropertiesService.getScriptProperties();
  if (input && String(input.geminiKey || '').trim()) props.setProperty(PROP.geminiKey, String(input.geminiKey).trim());
  if (input && String(input.telegramToken || '').trim()) props.setProperty(PROP.telegramToken, String(input.telegramToken).trim());
  return { saved: true, geminiConfigured: Boolean(props.getProperty(PROP.geminiKey)), telegramConfigured: Boolean(props.getProperty(PROP.telegramToken)) };
}

function runDashboardDryTest() {
  const result = testHistoricalNewsletter();
  result.testedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(PROP.lastTestResult, JSON.stringify(result));
  return result;
}

function scanInboxForNewsletters() {
  const settings = getSettings_();
  // The interactive tester deliberately scans only mail that is currently in
  // Inbox. Archived, Spam and Trash items must never appear in this picker,
  // even if an older saved UI query was broader.
  const inboxQuery = '(' + settings.gmailQuery + ') in:inbox -in:trash -in:spam';
  const threads = GmailApp.search(inboxQuery, 0, 50);
  const results = [];
  threads.forEach(thread => thread.getMessages().forEach(message => {
    if (!isNewsletter_(message)) return;
    results.push({
      messageId: message.getId(),
      threadId: thread.getId(),
      subject: message.getSubject(),
      from: message.getFrom(),
      receivedAt: message.getDate().toISOString(),
      processed: isProcessed_(message.getId())
    });
  }));
  results.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  return results;
}

function runDashboardDryTests(messageIds) {
  const ids = Array.isArray(messageIds) ? messageIds.map(String).filter(Boolean) : [];
  if (!ids.length) throw new Error('Select at least one newsletter.');
  if (ids.length > 10) throw new Error('Select no more than 10 newsletters in one test run.');
  const uniqueIds = ids.filter((id, index) => ids.indexOf(id) === index);
  return uniqueIds.map(messageId => {
    const result = processMessageById_(messageId, { testMode: true });
    result.testedAt = new Date().toISOString();
    result.previewSignature = signTestPreview_(result);
    return result;
  });
}

function testHistoricalNewsletter() {
  const props = PropertiesService.getScriptProperties();
  const messageId = requireProperty_(props, PROP.testMessageId);
  const result = processMessageById_(messageId, { testMode: true });
  result.testedAt = new Date().toISOString();
  props.setProperty(PROP.lastTestResult, JSON.stringify(result));
  console.log('TEST MODE complete. Gmail message was not labelled or modified; Telegram was not called.');
  console.log(result.proposedPost);
  return result;
}

function getLastTestResult() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP.lastTestResult);
  if (!raw) throw new Error('No test result exists. Run testHistoricalNewsletter first.');
  return JSON.parse(raw);
}

function sendDashboardTestPreview(input) {
  input = input || {};
  if (String(input.confirmPhrase || '') !== 'SEND PREVIEW TO TEST GROUP') throw new Error('Test publication confirmation was not supplied.');
  const result = {
    messageId: String(input.messageId || ''),
    proposedPost: String(input.proposedPost || ''),
    images: Array.isArray(input.images) ? input.images : [],
    links: Array.isArray(input.links) ? input.links : []
  };
  if (!result.messageId || !result.proposedPost) throw new Error('The selected preview is incomplete. Generate it again.');
  if (String(input.previewSignature || '') !== signTestPreview_(result)) throw new Error('The preview changed after generation. Generate it again before sending.');
  const destination = String(input.telegramChatId || '').trim();
  if (!destination) throw new Error('Choose a Telegram test destination.');
  const destinationInfo = telegramGetChat_(destination);
  const images = result.images || [];
  const links = result.links || [];
  const rich = telegramTrySendRich_(result.proposedPost, images, links, destination);
  if (rich) return { sent: true, mode: 'rich', messageIds: [rich.message_id], gmailModified: false, destination: destinationInfo };

  const items = buildFallbackPublicationItems_(result.proposedPost, images, getSettings_().maxTelegramChars, links);
  const messageIds = items.map(item => (item.type === 'photo' ? telegramSendPhoto_(item.url, destination, item.originalUrl) : telegramSend_(item.text, destination)).message_id);
  return { sent: true, mode: 'ordered_sequence', messageIds: messageIds, gmailModified: false, destination: destinationInfo };
}

function prepareEditedDashboardPreview(input) {
  input = input || {};
  const original = input.original || {};
  if (String(input.originalSignature || '') !== signTestPreview_(original)) {
    throw new Error('The original preview signature is invalid. Generate the preview again.');
  }
  const edited = {
    messageId: String(original.messageId || ''),
    proposedPost: String(input.proposedPost || '').trim(),
    images: Array.isArray(input.images) ? input.images : [],
    links: Array.isArray(original.links) ? original.links : []
  };
  if (!edited.proposedPost) throw new Error('The edited Telegram post cannot be empty.');
  if (edited.proposedPost.length > getSettings_().maxTelegramChars) {
    throw new Error('The edited post exceeds the configured Telegram character limit.');
  }
  edited.previewSignature = signTestPreview_(edited);
  return edited;
}

function signTestPreview_(result) {
  return digest_(JSON.stringify({
    messageId: String(result.messageId || ''),
    proposedPost: String(result.proposedPost || ''),
    images: result.images || [],
    links: result.links || []
  }));
}

function validateConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const report = {
    gmailAccount: Session.getEffectiveUser().getEmail(),
    geminiKeyPresent: Boolean(props.getProperty(PROP.geminiKey)),
    telegramTokenPresent: Boolean(props.getProperty(PROP.telegramToken)),
    telegramChatIdPresent: Boolean(props.getProperty(PROP.telegramChatId)),
    testMessageId: props.getProperty(PROP.testMessageId) || '',
    liveMode: props.getProperty(PROP.liveMode) === 'true',
    approvedMessageId: props.getProperty(PROP.approvedMessageId) || '',
    triggerInstalled: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'scheduledRun')
  };
  if (report.telegramTokenPresent) report.telegramBot = telegramGetMe_();
  if (report.telegramTokenPresent && report.telegramChatIdPresent) report.telegramDestination = telegramGetChat_();
  if (report.geminiKeyPresent) report.geminiModel = validateGemini_();
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function discoverTelegramChats() {
  const token = requireProperty_(PropertiesService.getScriptProperties(), PROP.telegramToken);
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates?limit=100&timeout=0', {
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText());
  if (!data.ok) {
    const detail = data.description ? ' ' + data.description : '';
    throw new Error('Telegram chat discovery failed.' + detail);
  }
  const chats = {};
  (data.result || []).forEach(update => {
    const candidates = [
      update.message && update.message.chat,
      update.channel_post && update.channel_post.chat,
      update.my_chat_member && update.my_chat_member.chat,
      update.chat_member && update.chat_member.chat
    ];
    candidates.filter(Boolean).forEach(chat => {
      if (!['group', 'supergroup', 'channel'].includes(chat.type)) return;
      chats[String(chat.id)] = {
        id: String(chat.id),
        type: chat.type,
        title: chat.title || (chat.username ? '@' + chat.username : 'Untitled Telegram chat')
      };
    });
  });
  const result = Object.keys(chats).map(id => chats[id]).sort((a, b) => a.title.localeCompare(b.title));
  if (!result.length) {
    throw new Error('No Telegram groups or channels were found. Send one ordinary message in the test group, then try discovery again.');
  }
  return result;
}

function saveDashboardTestDestination(chatId) {
  const value = String(chatId || '').trim();
  if (!value) throw new Error('Choose a Telegram test destination.');
  const chat = telegramGetChat_(value);
  PropertiesService.getScriptProperties().setProperty(PROP.testTelegramChatId, value);
  return chat;
}

function getTelegramDestinationInfo(chatId) {
  const value = String(chatId || '').trim();
  if (!value) return null;
  return telegramGetChat_(value);
}

function installHourlyTrigger() {
  if (PropertiesService.getScriptProperties().getProperty(PROP.liveMode) !== 'true') {
    throw new Error('Refusing to install the production trigger while LIVE_MODE is not true.');
  }
  removeAutomationTriggers_();
  const minutes = getSettings_().triggerEveryMinutes;
  ScriptApp.newTrigger('scheduledRun').timeBased().everyMinutes(minutes).create();
  return 'Hourly trigger installed.';
}

function disableAutomation() {
  removeAutomationTriggers_();
  PropertiesService.getScriptProperties().setProperty(PROP.liveMode, 'false');
  return 'Automation disabled and production triggers removed.';
}

function approveExactlyOneMessageForLivePublication(messageId) {
  if (!messageId) throw new Error('A Gmail message ID is required.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP.approvedMessageId, String(messageId));
  props.setProperty(PROP.liveMode, 'true');
  return 'Exactly one Gmail message is approved for live publication.';
}

function runApprovedMessageOnce() {
  const props = PropertiesService.getScriptProperties();
  const messageId = requireProperty_(props, PROP.approvedMessageId);
  return processMessageById_(messageId, { testMode: false, controlled: true });
}

function runAutomation_(options) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 'skipped', reason: 'another_run_is_active' };
  try {
    const props = PropertiesService.getScriptProperties();
    if (!options.testMode && props.getProperty(PROP.liveMode) !== 'true') {
      return { status: 'skipped', reason: 'live_mode_disabled' };
    }
    const settings = getSettings_();
    const threads = GmailApp.search(settings.gmailQuery, 0, 20);
    const candidates = [];
    threads.forEach(thread => thread.getMessages().forEach(message => {
      if (isNewsletter_(message)) candidates.push(message);
    }));
    candidates.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());
    const results = [];
    candidates.forEach(message => {
      if (!isProcessed_(message.getId())) results.push(processMessage_(message, options));
    });
    return { status: 'complete', candidates: candidates.length, results: results };
  } finally {
    lock.releaseLock();
  }
}

function processMessageById_(messageId, options) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another automation run is active.');
  try {
    const message = GmailApp.getMessageById(messageId);
    if (!message) throw new Error('Gmail message not found: ' + messageId);
    if (!isNewsletter_(message)) throw new Error('Message failed the strict Espavo newsletter checks.');
    return processMessage_(message, options);
  } finally {
    lock.releaseLock();
  }
}

function processMessage_(message, options) {
  const messageId = message.getId();
  const props = PropertiesService.getScriptProperties();
  if (!options.testMode && props.getProperty(PROP.liveMode) !== 'true') {
    throw new Error('Live publication is disabled.');
  }
  if (!options.testMode && options.controlled && props.getProperty(PROP.approvedMessageId) !== messageId) {
    throw new Error('This Gmail message has not been explicitly approved for the controlled live publication.');
  }
  if (!options.testMode && isProcessed_(messageId)) {
    ensureProcessedLabel_(message);
    return { status: 'duplicate_prevented', messageId: messageId };
  }

  const extracted = extractNewsletter_(message);
  const proposedPost = rewriteWithGemini_(extracted);
  const result = {
    status: options.testMode ? 'test_complete' : 'ready_to_publish',
    messageId: messageId,
    subject: message.getSubject(),
    receivedAt: message.getDate().toISOString(),
    assumptions: extracted.assumptions,
    sourceChars: extracted.text.length,
    imageCount: extracted.images.length,
    images: extracted.images,
    linkCount: extracted.links.length,
    links: extracted.links,
    originalHtmlPreview: extracted.originalHtmlPreview || '',
    cleanedSourcePreview: extracted.text.slice(0, 8000),
    proposedPost: proposedPost
  };

  if (options.testMode) return result;

  const published = publishIdempotently_(messageId, proposedPost, extracted.images, extracted.links);
  ensureProcessedLabel_(message);
  clearErrorLabel_(message);
  props.deleteProperty(PROP.approvedMessageId);
  result.status = published.resumed ? 'published_after_retry' : 'published';
  result.telegramMessageIds = published.messageIds;
  return result;
}

function isNewsletter_(message) {
  const settings = getSettings_();
  const raw = message.getRawContent();
  const headerText = raw.split(/\r?\n\r?\n/, 1)[0];
  const from = String(message.getFrom() || '').toLowerCase();
  if (!new RegExp('(?:<|\\b)' + escapeRegex_(settings.sender) + '(?:>|\\b)', 'i').test(from)) return false;
  const checks = [
    /^precedence:\s*bulk\s*$/im.test(headerText),
    /^list-unsubscribe:/im.test(headerText),
    /^feedback-id:.*mailerlite/im.test(headerText),
    /^message-id:.*@mlsend\.com>/im.test(headerText),
    /dkim=pass[^\r\n]*header\.i=@espavo\.org/i.test(headerText) || /dkim-signature:[^\r\n]*\bd=espavo\.org\b/i.test(headerText),
    /content-type:\s*multipart\/alternative/i.test(headerText)
  ];
  return checks.filter(Boolean).length >= 4;
}

function extractNewsletter_(message) {
  const settings = getSettings_();
  const html = String(message.getBody() || '');
  const plain = String(message.getPlainBody() || '');
  const imageAware = html ? htmlToImageAwareText_(html, settings.maxNewsletterImages, settings.maxNewsletterLinks) : { text: '', images: [], links: [] };
  let text = html ? imageAware.text : cleanPlainText_(plain);
  if (text.length < 250 && plain) text = cleanPlainText_(plain);
  text = applyCustomParsing_(text, settings);
  if (!text || text.length < settings.minimumSourceChars) throw new Error('No useful newsletter content remained after the configured parsing rules.');
  const originalLength = text.length;
  if (text.length > settings.maxSourceChars) text = text.slice(0, settings.maxSourceChars);
  return {
    subject: message.getSubject(),
    date: message.getDate().toISOString(),
    text: text,
    images: imageAware.images,
    links: imageAware.links || [],
    originalHtmlPreview: html ? sanitizeOriginalEmailPreview_(html) : '',
    assumptions: [
      html ? 'Used the HTML edition because the plain-text part is only a view-in-browser fallback.' : 'Used the plain-text edition.',
      'Removed MailerLite tracking, unsubscribe, postal-address, social-share, and repeated navigation boilerplate.',
      originalLength > settings.maxSourceChars ? 'Source was capped at ' + settings.maxSourceChars + ' characters before rewriting.' : 'The complete cleaned source fitted within the rewrite limit.',
      (imageAware.links || []).length
        ? 'Preserved ' + imageAware.links.length + ' useful hyperlink(s) as protected markers so Gemini cannot alter or omit their destinations.'
        : 'No useful editorial hyperlinks were found after newsletter boilerplate was excluded.',
      imageAware.images.length
        ? 'Selected ' + imageAware.images.length + ' meaningful newsletter image(s) in source order; tracking pixels, social icons, logos, and layout graphics were excluded.'
        : 'No meaningful newsletter images were found after tracking and layout graphics were excluded.'
    ]
  };
}

function htmlToImageAwareText_(html, maxImages, maxLinks) {
  const images = [];
  const links = [];
  const linkLimit = Number(maxLinks || CONFIG.maxNewsletterLinks || 30);
  const seen = {};
  const seenLinks = {};
  let s = String(html || '');
  s = s.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(?:strong|b)\b[^>]*>/gi, ' [[B]] ')
    .replace(/<\/(?:strong|b)>/gi, ' [[/B]] ')
    .replace(/<(?:em|i)\b[^>]*>/gi, ' [[I]] ')
    .replace(/<\/(?:em|i)>/gi, ' [[/I]] ')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n[[B]] ')
    .replace(/<\/h[1-6]>/gi, ' [[/B]]\n')
    .replace(/<img\b[^>]*>/gi, function(tag) {
      if (images.length >= maxImages) return ' ';
      const candidate = newsletterImageFromTag_(tag);
      if (!candidate || seen[candidate.url]) return ' ';
      seen[candidate.url] = true;
      candidate.marker = '[[IMAGE_' + (images.length + 1) + ']]';
      images.push(candidate);
      return '\n' + candidate.marker + '\n';
    })
    .replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, function(tag, url, label) {
      const decodedUrl = decodeHtmlEntities_(url).trim();
      const embeddedImageMarkers = (String(label).match(/\[\[IMAGE_\d+\]\]/g) || []).join(' ');
      const labelText = stripTags_(label).replace(/\[\[IMAGE_\d+\]\]/g, '');
      const hasBold = /\[\[B\]\]/.test(labelText) || /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(tag);
      const hasItalic = /\[\[I\]\]/.test(labelText) || /font-style\s*:\s*italic/i.test(tag);
      const cleanLabel = labelText.replace(/\[\[\/?(?:B|I)\]\]/g, '').replace(/\s+/g, ' ').trim();
      const blockedLabel = /^(?:unsubscribe|manage preferences|view (?:this )?(?:email|newsletter) in (?:your )?browser|share|facebook|instagram|youtube|x|twitter|forward email)$/i;
      const preservedContent = ' ' + (embeddedImageMarkers ? embeddedImageMarkers + ' ' : '') + cleanLabel + ' ';
      if (links.length >= linkLimit || blockedLabel.test(cleanLabel) || !isUsefulNewsletterLink_(decodedUrl, cleanLabel)) return preservedContent;
      if (!decodedUrl || seenLinks[decodedUrl]) return preservedContent;
      seenLinks[decodedUrl] = true;
      const marker = '[[LINK_' + (links.length + 1) + ']]';
      links.push({ marker: marker, url: decodedUrl, label: cleanLabel || decodedUrl });
      const openStyle = (hasBold ? '[[B]] ' : '') + (hasItalic ? '[[I]] ' : '');
      const closeStyle = (hasItalic ? ' [[/I]]' : '') + (hasBold ? ' [[/B]]' : '');
      return ' ' + (embeddedImageMarkers ? embeddedImageMarkers + ' ' : '') + openStyle + (cleanLabel ? cleanLabel + ' ' : '') + marker + closeStyle + ' ';
    })
    .replace(/<\/?(?:p|div|tr|table|h[1-6]|li|ul|ol|br|section|article|figure)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = removeBoilerplate_(decodeHtmlEntities_(s));
  return { text: s, images: images, links: links };
}

function newsletterImageFromTag_(tag) {
  const attrs = {};
  String(tag).replace(/([\w:-]+)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/g, function(_, name, quoted, bare) {
    attrs[name.toLowerCase()] = decodeHtmlEntities_(quoted !== undefined ? quoted : bare);
    return _;
  });
  const url = String(attrs.src || attrs['data-src'] || '').trim();
  if (!/^https:\/\//i.test(url) || isTrackingUrl_(url)) return null;
  const alt = String(attrs.alt || attrs.title || '').replace(/\s+/g, ' ').trim();
  const fingerprint = (url + ' ' + alt).toLowerCase();
  if (/(?:spacer|tracking|pixel|transparent|blank|facebook|instagram|youtube|twitter|linkedin|pinterest|social[-_ ]?icon|\/logo(?:[._/-]|$)|logo[._-])/i.test(fingerprint)) return null;
  const style = String(attrs.style || '');
  const width = numericDimension_(attrs.width) || numericDimension_((style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i) || [])[1]);
  const height = numericDimension_(attrs.height) || numericDimension_((style.match(/(?:^|;)\s*height\s*:\s*([^;]+)/i) || [])[1]);
  if ((width && width <= 120) || (height && height <= 80) || (width && height && width * height < 30000)) return null;
  const circular = width >= 300 && height >= 300 && Math.abs(width - height) / Math.max(width, height) <= 0.08;
  return { url: circular ? circularTransparentImageUrl_(url) : url, originalUrl: circular ? url : '', circular: circular, alt: alt, width: width || null, height: height || null };
}

function circularTransparentImageUrl_(url) {
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(String(url || '')) + '&w=1200&h=1200&fit=cover&mask=circle&mtrim&output=png';
}

function numericDimension_(value) {
  const match = String(value || '').match(/^\s*(\d{1,5})(?:px)?\s*$/i);
  return match ? Number(match[1]) : 0;
}

function htmlToCleanText_(html) {
  return htmlToImageAwareText_(html, 0).text;
}

function cleanPlainText_(plain) {
  return removeBoilerplate_(decodeHtmlEntities_(String(plain || '')));
}

function removeBoilerplate_(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(x => x.replace(/\s+/g, ' ').trim());
  const blocked = /^(view in browser|unsubscribe|not interested anymore|share to (facebook|x)|forward email|you received this email because|you're receiving this newsletter because|espavo\s*$|\d{3,5}\s+farm rd\b|nv\s+\d{5}\b)/i;
  const out = [];
  lines.forEach(line => {
    if (!line || blocked.test(line) || (isTrackingUrl_(line) && /^https?:\/\/\S+$/i.test(line))) return;
    if (out.length && out[out.length - 1] === line) return;
    out.push(line);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function rewriteWithGemini_(extracted) {
  const settings = getSettings_();
  const props = PropertiesService.getScriptProperties();
  const key = requireProperty_(props, PROP.geminiKey);
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(settings.model) + ':generateContent?key=' + encodeURIComponent(key);
  const imageInstruction = extracted.images.length
    ? '\n\nIMAGE PLACEMENT RULES:\nThe cleaned source contains markers such as [[IMAGE_1]]. Preserve every image marker exactly once, unchanged, on its own line and place it between the rewritten paragraphs most closely related to that image. Do not describe or invent image contents.'
    : '';
  const linkInstruction = extracted.links.length
    ? '\n\nLINK RULES:\nThe cleaned source contains protected markers such as [[LINK_1]]. Each marker renders as the original clickable link label, so preserve every marker exactly once and do not repeat its label immediately before or after it. Never invent, edit, shorten, or replace a link marker.'
    : '';
  const structureInstruction = '\n\nNON-NEGOTIABLE FIDELITY RULES:\nThis is a faithful Telegram conversion, not a reorganisation. Work through the source from top to bottom. Preserve the original heading, paragraph, section, event, image and link order. Preserve every [[IMAGE_n]], [[LINK_n]], [[B]], [[/B]], [[I]] and [[/I]] marker exactly once and in the exact combined order in which the markers occur in the source. These protected style markers reproduce the original bold and italic emphasis in Telegram. Keep each marker beside the same surrounding content; never collect images, links or formatting elsewhere. Do not merge separate source sections, invent a new section, move a call-to-action, or add a More information section. Lightly shorten repetitive prose only where needed for Telegram, without changing the newsletter hierarchy.';
  const formatInstruction = '\n\nREADABILITY RULES:\nRetain the source section breaks. Use short, naturally spaced paragraphs and simple bullets only where the source already presents a list. Leave a blank line between sections. Avoid adding new headings.';
  const expectedMarkers = protectedMarkerSequence_(extracted.text).join(' ');
  const prompt = settings.rewritePrompt + structureInstruction + formatInstruction + imageInstruction + linkInstruction + '\n\nREQUIRED MARKER SEQUENCE (copy exactly):\n' + expectedMarkers + '\n\nNEWSLETTER SUBJECT:\n' + extracted.subject + '\n\nCLEANED SOURCE:\n' + extracted.text;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 4096,
      // Gemini 3 thinking tokens count toward maxOutputTokens. Rewriting is a
      // straightforward editorial task, so keep reasoning minimal and reserve
      // the token budget for the actual Telegram post.
      thinkingConfig: { thinkingLevel: 'MINIMAL' }
    }
  };
  const response = fetchWithRetry_(endpoint, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  }, 'Gemini');
  const data = JSON.parse(response.getContentText());
  const candidate = (data.candidates || [])[0] || {};
  const text = (candidate.content || {}).parts;
  let output = Array.isArray(text) ? text.map(p => p.text || '').join('').trim() : '';
  output = output.replace(/^```(?:text)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (String(candidate.finishReason || '').toUpperCase() === 'MAX_TOKENS') {
    throw new Error('Gemini reached its output limit before completing the post. Nothing was published; increase the output budget or shorten the source.');
  }
  if (!output) throw new Error('Gemini returned no usable text.');
  output = [settings.postPrefix, output, settings.postSuffix].filter(Boolean).join('\n\n').trim();
  output = stripTrackingUrlsFromPost_(output);
  output = normalizeProtectedMarkers_(output);
  assertFaithfulMarkerStructure_(extracted.text, output);
  (extracted.links || []).forEach(link => { output = removeDuplicateLinkLabel_(output, link); });
  if (output.length > settings.maxTelegramChars) {
    throw new Error('The faithful Telegram draft exceeds the configured length. Nothing was published; shorten prose without moving or removing images and links.');
  }
  return output;
}

function normalizeProtectedMarkers_(value) {
  return String(value || '')
    .replace(/\[\[\s*IMAGE[_ -]?(\d+)\s*\]\]/gi, '[[IMAGE_$1]]')
    .replace(/\[\[\s*LINK[_ -]?(\d+)\s*\]\]/gi, '[[LINK_$1]]');
}

function protectedMarkerSequence_(value) {
  return normalizeProtectedMarkers_(value).match(/\[\[(?:IMAGE|LINK)_\d+\]\]|\[\[\/?(?:B|I)\]\]/g) || [];
}

function assertFaithfulMarkerStructure_(source, draft) {
  const expected = protectedMarkerSequence_(source);
  const actual = protectedMarkerSequence_(draft);
  if (expected.length !== actual.length || expected.some((marker, index) => marker !== actual[index])) {
    throw new Error('The AI changed the newsletter image/link order or duplicated/omitted a marker, so this preview was rejected. Nothing was sent or marked processed.');
  }
}

function ensureImageMarkers_(post, images) {
  let output = String(post || '').replace(/\[\[\s*IMAGE[_ -]?(\d+)\s*\]\]/gi, '[[IMAGE_$1]]');
  const trailing = output.match(/(?:\s*\[\[IMAGE_\d+\]\]\s*)+$/);
  const redistribute = {};
  if (trailing) {
    (trailing[0].match(/\[\[IMAGE_\d+\]\]/g) || []).forEach(marker => { redistribute[marker] = true; });
    output = output.slice(0, trailing.index).trim();
  }
  const missing = [];
  (images || []).forEach(image => {
    const marker = image.marker;
    const first = output.indexOf(marker);
    if (first < 0 || redistribute[marker]) missing.push(image);
    else {
      const before = output.slice(0, first + marker.length);
      const after = output.slice(first + marker.length).split(marker).join('');
      output = before + after;
    }
  });
  if (missing.length) output = interleaveMissingImages_(output, missing, images || []);
  return output.trim();
}

function interleaveMissingImages_(post, missingImages, allImages) {
  const blocks = String(post || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const textCount = Math.max(1, blocks.filter(block => !/^\[\[IMAGE_\d+\]\]$/.test(block)).length);
  missingImages.forEach(image => {
    const sourceIndex = Math.max(0, allImages.findIndex(item => item.marker === image.marker));
    const desiredTextPosition = Math.max(1, Math.ceil((sourceIndex + 1) * textCount / (Math.max(1, allImages.length) + 1)));
    let seenText = 0;
    let insertAt = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      if (!/^\[\[IMAGE_\d+\]\]$/.test(blocks[i])) seenText++;
      if (seenText >= desiredTextPosition) { insertAt = i + 1; break; }
    }
    while (insertAt < blocks.length && /^\[\[IMAGE_\d+\]\]$/.test(blocks[insertAt])) insertAt++;
    blocks.splice(insertAt, 0, image.marker);
  });
  return blocks.join('\n\n');
}

function ensureLinkMarkers_(post, links) {
  let output = String(post || '').replace(/\[\[\s*LINK[_ -]?(\d+)\s*\]\]/gi, '[[LINK_$1]]');
  (links || []).forEach(link => {
    const marker = link.marker;
    const first = output.indexOf(marker);
    if (first < 0) {
      const label = String(link.label || '').trim();
      const matchAt = label ? output.toLowerCase().indexOf(label.toLowerCase()) : -1;
      if (matchAt >= 0) {
        const insertAt = matchAt + label.length;
        output = output.slice(0, insertAt) + ' ' + marker + output.slice(insertAt);
      } else {
        output += '\n\nMore information: ' + marker;
      }
    }
    else {
      const before = output.slice(0, first + marker.length);
      const after = output.slice(first + marker.length).split(marker).join('');
      output = before + after;
    }
    output = removeDuplicateLinkLabel_(output, link);
  });
  return output.trim();
}

function removeDuplicateLinkLabel_(text, link) {
  const marker = String(link && link.marker || '');
  const label = String(link && link.label || '').trim();
  if (!marker || !label) return String(text || '');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text || '').replace(new RegExp(escaped + '[ \\t]*' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), marker);
}

function validateGemini_() {
  const settings = getSettings_();
  const key = requireProperty_(PropertiesService.getScriptProperties(), PROP.geminiKey);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(settings.model) + '?key=' + encodeURIComponent(key);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Gemini validation failed with HTTP ' + response.getResponseCode() + '.');
  const data = JSON.parse(response.getContentText());
  return { name: data.name, displayName: data.displayName };
}

function publishIdempotently_(messageId, post, images, links) {
  const settings = getSettings_();
  const props = PropertiesService.getScriptProperties();
  const key = 'PUBLISH_JOURNAL_' + messageId;
  const media = images || [];
  const preservedLinks = links || [];
  const publicationHash = digest_(post + '\n' + media.map(image => image.url).join('\n') + '\n' + preservedLinks.map(link => link.url).join('\n'));
  let journal = parseJson_(props.getProperty(key)) || { hash: publicationHash, mode: '', next: 0, sent: [] };
  if (journal.hash !== publicationHash) throw new Error('Publication journal exists but the proposed post or images changed. Manual review is required.');
  const resumed = journal.sent.length > 0;

  if (!journal.mode && media.length) {
    const rich = telegramTrySendRich_(post, media, preservedLinks);
    if (rich) {
      journal.mode = 'rich';
      journal.next = 1;
      journal.sent.push(rich.message_id);
      props.setProperty(key, JSON.stringify(journal));
    } else {
      journal.mode = 'ordered_sequence';
      props.setProperty(key, JSON.stringify(journal));
    }
  } else if (!journal.mode) {
    journal.mode = 'text';
    props.setProperty(key, JSON.stringify(journal));
  }

  if (journal.mode !== 'rich') {
    const items = buildFallbackPublicationItems_(post, media, settings.maxTelegramChars, preservedLinks);
    for (let i = journal.next || 0; i < items.length; i++) {
      const sent = items[i].type === 'photo' ? telegramSendPhoto_(items[i].url, null, items[i].originalUrl) : telegramSend_(items[i].text);
      journal.sent.push(sent.message_id);
      journal.next = i + 1;
      props.setProperty(key, JSON.stringify(journal));
    }
  }
  props.setProperty('PROCESSED_' + messageId, JSON.stringify({ at: new Date().toISOString(), telegramMessageIds: journal.sent }));
  return { messageIds: journal.sent, resumed: resumed };
}

function telegramTrySendRich_(post, images, links, chatIdOverride) {
  const props = PropertiesService.getScriptProperties();
  const token = requireProperty_(props, PROP.telegramToken);
  const chatId = String(chatIdOverride || requireProperty_(props, PROP.telegramChatId));
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendRichMessage', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: chatId, rich_message: { html: buildTelegramRichHtml_(post, images, links) } })
  });
  const code = response.getResponseCode();
  const data = parseJson_(response.getContentText()) || {};
  if (code >= 200 && code < 300 && data.ok && data.result && data.result.message_id) return data.result;
  if ((code === 400 || code === 404) && /(?:method|rich|unsupported|can't parse|failed to get http url content|not found)/i.test(String(data.description || ''))) return null;
  throw new Error('Telegram rich-message request failed with HTTP ' + code + ': ' + String(data.description || 'unknown error'));
}

function buildTelegramRichHtml_(post, images, links) {
  const byMarker = {};
  (images || []).forEach(image => { byMarker[image.marker] = image; });
  return String(post || '').split(/(\[\[IMAGE_\d+\]\])/g).filter(Boolean).map(part => {
    const image = byMarker[part];
    if (image) return '<img src="' + escapeHtml_(image.url) + '"/>';
    return part.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean)
      .map(paragraph => '<p>' + richTextWithLinks_(paragraph, links).replace(/\n/g, '<br>') + '</p>').join('');
  }).join('');
}

function richTextWithLinks_(text, links) {
  const byMarker = {};
  (links || []).forEach(link => { byMarker[link.marker] = link; });
  return String(text || '').split(/(\[\[LINK_\d+\]\]|\[\[\/?(?:B|I)\]\])/g).filter(Boolean).map(part => {
    const link = byMarker[part];
    if (part === '[[B]]') return '<b>';
    if (part === '[[/B]]') return '</b>';
    if (part === '[[I]]') return '<i>';
    if (part === '[[/I]]') return '</i>';
    return link
      ? '<a href="' + escapeHtml_(link.url) + '">' + escapeHtml_(link.label || link.url) + '</a>'
      : escapeHtml_(part);
  }).join('');
}

function expandLinkMarkers_(text, links) {
  let output = String(text || '');
  (links || []).forEach(link => {
    const label = String(link.label || '').trim();
    const url = String(link.url || '').trim();
    const replacement = !label || label === url ? url : label + ': ' + url;
    output = output.split(link.marker).join(replacement);
  });
  return output;
}

function telegramTextHtml_(text, links) {
  return richTextWithLinks_(String(text || ''), links);
}

function buildFallbackPublicationItems_(post, images, limit, links) {
  const byMarker = {};
  (images || []).forEach(image => { byMarker[image.marker] = image; });
  const items = [];
  String(post || '').split(/(\[\[IMAGE_\d+\]\])/g).filter(Boolean).forEach(part => {
    if (byMarker[part]) items.push({ type: 'photo', url: byMarker[part].url, originalUrl: byMarker[part].originalUrl || '' });
    else splitTelegram_(part, limit).filter(Boolean).forEach(text => items.push({ type: 'text', text: telegramTextHtml_(text, links) }));
  });
  return items;
}

function telegramSendPhoto_(url, chatIdOverride, fallbackUrl) {
  const props = PropertiesService.getScriptProperties();
  const token = requireProperty_(props, PROP.telegramToken);
  const chatId = String(chatIdOverride || requireProperty_(props, PROP.telegramChatId));
  function sendPhotoUrl_(photoUrl) {
    const response = fetchWithRetry_('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chatId, photo: photoUrl })
    }, 'Telegram');
    const data = JSON.parse(response.getContentText());
    if (!data.ok || !data.result || !data.result.message_id) throw new Error('Telegram did not confirm image publication.');
    return data.result;
  }
  try {
    return sendPhotoUrl_(url);
  } catch (error) {
    if (fallbackUrl && fallbackUrl !== url) return sendPhotoUrl_(fallbackUrl);
    throw error;
  }
}

function telegramSend_(text, chatIdOverride) {
  const props = PropertiesService.getScriptProperties();
  const token = requireProperty_(props, PROP.telegramToken);
  const chatId = String(chatIdOverride || requireProperty_(props, PROP.telegramChatId));
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const response = fetchWithRetry_(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: false })
  }, 'Telegram');
  const data = JSON.parse(response.getContentText());
  if (!data.ok || !data.result || !data.result.message_id) throw new Error('Telegram did not confirm publication.');
  return data.result;
}

function telegramGetMe_() {
  const token = requireProperty_(PropertiesService.getScriptProperties(), PROP.telegramToken);
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true });
  const data = JSON.parse(response.getContentText());
  if (!data.ok) throw new Error('Telegram bot token validation failed.');
  return { id: data.result.id, username: data.result.username, name: data.result.first_name };
}

function telegramGetChat_(chatIdOverride) {
  const props = PropertiesService.getScriptProperties();
  const token = requireProperty_(props, PROP.telegramToken);
  const chatId = String(chatIdOverride || requireProperty_(props, PROP.telegramChatId));
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getChat?chat_id=' + encodeURIComponent(chatId), { muteHttpExceptions: true });
  const data = JSON.parse(response.getContentText());
  if (!data.ok) throw new Error('Telegram destination validation failed.');
  const chat = data.result || {};
  const info = {
    id: chat.id,
    type: chat.type,
    title: chat.title || chat.username || '',
    username: chat.username ? '@' + chat.username : '',
    description: chat.description || '',
    inviteLink: chat.invite_link || '',
    protectedContent: Boolean(chat.has_protected_content),
    slowModeSeconds: chat.slow_mode_delay || 0,
    memberCount: null,
    botStatus: '',
    canPostMessages: null,
    canEditMessages: null,
    canDeleteMessages: null,
    canInviteUsers: null
  };
  try {
    const countResponse = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getChatMemberCount?chat_id=' + encodeURIComponent(chatId), { muteHttpExceptions: true });
    const countData = parseJson_(countResponse.getContentText()) || {};
    if (countData.ok) info.memberCount = countData.result;
  } catch (_) {}
  try {
    const bot = telegramGetMe_();
    const memberResponse = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getChatMember?chat_id=' + encodeURIComponent(chatId) + '&user_id=' + encodeURIComponent(bot.id), { muteHttpExceptions: true });
    const memberData = parseJson_(memberResponse.getContentText()) || {};
    if (memberData.ok && memberData.result) {
      info.botStatus = memberData.result.status || '';
      ['can_post_messages', 'can_edit_messages', 'can_delete_messages', 'can_invite_users'].forEach(key => {
        const mapped = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        info[mapped] = memberData.result[key] === undefined ? null : Boolean(memberData.result[key]);
      });
    }
  } catch (_) {}
  return info;
}

function fetchWithRetry_(url, options, serviceName) {
  const settings = getSettings_();
  let response;
  for (let attempt = 1; attempt <= settings.maxRetries; attempt++) {
    response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) return response;
    if (attempt === settings.maxRetries || ![408, 429, 500, 502, 503, 504].includes(code)) {
      throw new Error(serviceName + ' request failed with HTTP ' + code + '.');
    }
    Utilities.sleep(Math.pow(2, attempt - 1) * 1000 + Math.floor(Math.random() * 300));
  }
  return response;
}

function splitTelegram_(text, limit) {
  const clean = String(text || '').trim();
  if (clean.length <= limit) return [clean];
  const chunks = [];
  let rest = clean;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < Math.floor(limit * 0.6)) cut = rest.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.6)) cut = rest.lastIndexOf(' ', limit);
    if (cut < 1) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function intelligentlyTrim_(text, limit) {
  let cut = text.slice(0, limit - 1);
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));
  if (boundary > limit * 0.7) cut = cut.slice(0, boundary + 1);
  return cut.trim() + '…';
}

function isProcessed_(messageId) {
  return Boolean(PropertiesService.getScriptProperties().getProperty('PROCESSED_' + messageId));
}

function ensureProcessedLabel_(message) {
  const name = getSettings_().processedLabel;
  const label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  message.getThread().addLabel(label);
}

function clearErrorLabel_(message) {
  const label = GmailApp.getUserLabelByName(getSettings_().errorLabel);
  if (label) message.getThread().removeLabel(label);
}

function removeAutomationTriggers_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'scheduledRun').forEach(t => ScriptApp.deleteTrigger(t));
}

function requireProperty_(props, name) {
  const value = props.getProperty(name);
  if (!value) throw new Error('Missing required Script Property: ' + name);
  return value;
}

function stripTags_(value) { return String(value || '').replace(/<[^>]+>/g, ' '); }
function isTrackingUrl_(value) { return /(?:(?:^|\/\/)(?:[^/]+\.)?(?:mlsend\.com|mailerlite\.com)\b|unsubscribe|mailto:)/i.test(String(value || '')); }
function isUsefulNewsletterLink_(url, label) {
  const value = String(url || '').trim();
  const text = String(label || '').trim();
  if (!/^https:\/\//i.test(value)) return false;
  const meaningfulLabel = text.length >= 4 && !/^(?:click here|read more|learn more|website|link)$/i.test(text);
  if (isTrackingUrl_(value) && !(/(?:^|\.)mlsend\.com\//i.test(value) && meaningfulLabel)) return false;
  if (/\b(?:facebook|instagram|youtube|twitter|linkedin|pinterest)\.com\b/i.test(value) && /^(?:facebook|instagram|youtube|x|twitter|linkedin|pinterest)?$/i.test(text)) return false;
  return !/^(?:unsubscribe|manage preferences|view in browser|share|forward)$/i.test(text);
}
function sanitizeOriginalEmailPreview_(html) {
  let value = String(html || '').slice(0, 180000);
  value = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?:script|iframe|object|embed|form|button)\b[\s\S]*?<\/(?:script|iframe|object|embed|form|button)>/gi, '')
    .replace(/<(?:script|iframe|object|embed|form|input|button)\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, '')
    .replace(/@import\s+url\([^)]*\)\s*;?/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<img\b[^>]*(?:class=["'][^"']*open_img[^"']*["']|width=["']?1["']?[^>]*height=["']?1["']?|height=["']?0["']?)[^>]*>/gi, '')
    .replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*')/gi, ' href="#"')
    .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  const guard = '<style>html,body{margin:0!important;padding:0!important;background:#fff!important;overflow-x:auto}a{cursor:default!important}img{max-width:100%;height:auto}body{pointer-events:none}</style>';
  return value.replace(/<head[^>]*>/i, '$&' + guard);
}
function stripTrackingUrlsFromPost_(post) {
  return String(post || '').replace(/https?:\/\/[^\s<>()]+/gi, function(url) {
    return isTrackingUrl_(url.replace(/[.,;:!?]+$/, '')) ? '' : url;
  }).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function escapeHtml_(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function escapeRegex_(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function parseJson_(value) { try { return value ? JSON.parse(value) : null; } catch (_) { return null; } }
function digest_(value) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)).replace(/=+$/, ''); }

function decodeHtmlEntities_(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, function(_, entity) {
    if (entity.charAt(0) === '#') {
      const hex = entity.charAt(1).toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return isFinite(code) ? String.fromCharCode(code) : _;
    }
    return named[entity.toLowerCase()] || _;
  });
}

function getSettings_() {
  const saved = parseJson_(PropertiesService.getScriptProperties().getProperty('UI_CONFIG')) || {};
  return sanitizeSettings_(Object.assign({}, CONFIG, saved));
}

function sanitizeSettings_(input) {
  const defaults = CONFIG;
  const sender = String(input.sender || defaults.sender).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new Error('Newsletter sender must be a valid email address.');
  const triggerMinutes = [15, 30, 60].includes(Number(input.triggerEveryMinutes)) ? Number(input.triggerEveryMinutes) : 60;
  return {
    sender: sender,
    processedLabel: String(input.processedLabel || defaults.processedLabel).trim(),
    errorLabel: String(input.errorLabel || defaults.errorLabel).trim(),
    gmailQuery: String(input.gmailQuery || ('from:' + sender + ' newer_than:180d -in:spam -in:trash')).trim(),
    model: String(input.model || defaults.model).trim(),
    maxSourceChars: clamp_(Number(input.maxSourceChars), 2000, 50000, defaults.maxSourceChars),
    minimumSourceChars: clamp_(Number(input.minimumSourceChars), 100, 5000, 250),
    maxTelegramChars: clamp_(Number(input.maxTelegramChars), 1000, 4000, defaults.maxTelegramChars),
    maxNewsletterImages: clamp_(Number(input.maxNewsletterImages), 1, 10, defaults.maxNewsletterImages),
    maxNewsletterLinks: clamp_(Number(input.maxNewsletterLinks), 1, 50, defaults.maxNewsletterLinks),
    triggerEveryMinutes: triggerMinutes,
    maxRetries: clamp_(Number(input.maxRetries), 1, 5, defaults.maxRetries),
    rewritePrompt: String(input.rewritePrompt || defaults.rewritePrompt).trim(),
    stripBefore: String(input.stripBefore || '').trim(),
    stripAfter: String(input.stripAfter || '').trim(),
    removePatterns: String(input.removePatterns || '').trim(),
    postPrefix: String(input.postPrefix || '').trim(),
    postSuffix: String(input.postSuffix || '').trim(),
    testMessageId: String(input.testMessageId || PropertiesService.getScriptProperties().getProperty(PROP.testMessageId) || defaults.testMessageId).trim(),
    telegramChatId: String(input.telegramChatId || PropertiesService.getScriptProperties().getProperty(PROP.telegramChatId) || '').trim(),
    testTelegramChatId: String(input.testTelegramChatId || PropertiesService.getScriptProperties().getProperty(PROP.testTelegramChatId) || PropertiesService.getScriptProperties().getProperty(PROP.telegramChatId) || '').trim()
  };
}

function applyCustomParsing_(text, settings) {
  let value = String(text || '');
  if (settings.stripBefore) {
    const start = value.toLowerCase().indexOf(settings.stripBefore.toLowerCase());
    if (start >= 0) value = value.slice(start + settings.stripBefore.length);
  }
  if (settings.stripAfter) {
    const end = value.toLowerCase().indexOf(settings.stripAfter.toLowerCase());
    if (end >= 0) value = value.slice(0, end);
  }
  if (settings.removePatterns) {
    settings.removePatterns.split('\n').map(x => x.trim()).filter(Boolean).forEach(pattern => {
      try { value = value.replace(new RegExp(pattern, 'gim'), ' '); }
      catch (_) { throw new Error('Invalid removal pattern: ' + pattern); }
    });
  }
  return value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function clamp_(value, min, max, fallback) {
  return isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
}

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const manifest = JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8'));
assert.deepStrictEqual(manifest.webapp, { access: 'MYSELF', executeAs: 'USER_DEPLOYING' });

const source = fs.readFileSync(__dirname + '/Code.gs', 'utf8');
const dashboardHtml = fs.readFileSync(__dirname + '/Index.html', 'utf8');
const appVersion = source.match(/const APP_VERSION = '(\d+\.\d+\.\d+)';/);
assert(appVersion, 'APP_VERSION must be a semantic version in Code.gs');
assert(dashboardHtml.includes('<?= appVersion ?>'), 'dashboard header must show the template appVersion');
const sandbox = {
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (_algorithm, value) => Array.from(require('crypto').createHash('sha256').update(value).digest()),
    base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url')
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const dirty = `<!doctype html><html><head><style>x</style></head><body>
<p>View in browser</p><h1>Walking Each Other Home</h1>
<p>A warm &amp; useful teaching.</p>
<a href="https://click.mlsend.com/link/c/tracker">Tracked CTA</a>
<a href="https://steverother.org/event">Event details</a>
<p>You received this email because you signed up on our website.</p>
</body></html>`;
const cleaned = sandbox.htmlToCleanText_(dirty);
assert(cleaned.includes('Walking Each Other Home'));
assert(cleaned.includes('A warm & useful teaching.'));
assert(cleaned.includes('[[LINK_1]]'));
assert(cleaned.includes('[[LINK_2]]'));
assert(!cleaned.includes('https://click.mlsend.com'));
assert(!cleaned.toLowerCase().includes('you received this email'));
const linked = sandbox.htmlToImageAwareText_(dirty, 0);
assert.strictEqual(linked.links.length, 2);
assert(linked.links.some(link => link.url === 'https://steverother.org/event'));
assert(linked.links.some(link => link.label === 'Tracked CTA'));
assert(linked.links.some(link => link.label === 'Event details'));

const imageHtml = `<html><body>
<p>Opening teaching</p>
<img src="https://cdn.example.org/hero.jpg" width="640" height="360" alt="Steve speaking">
<p>Related paragraph</p>
<img src="https://cdn.example.org/facebook-icon.png" width="32" height="32" alt="Facebook">
<img src="https://cdn.example.org/tracker.gif" width="1" height="1">
<img src="https://cdn.example.org/second.jpg" width="600" height="400" alt="Community gathering">
</body></html>`;
const imageAware = sandbox.htmlToImageAwareText_(imageHtml, 8);
assert.strictEqual(imageAware.images.length, 2);
assert(imageAware.text.includes('[[IMAGE_1]]'));
assert(imageAware.text.includes('[[IMAGE_2]]'));
assert.strictEqual(imageAware.images[0].alt, 'Steve speaking');
const linkedImage = sandbox.htmlToImageAwareText_('<a href="https://steverother.org/video"><img src="https://cdn.example.org/video.jpg" width="640" height="360" alt="Video"><span>Watch</span></a>', 8);
assert.deepStrictEqual(Array.from(sandbox.protectedMarkerSequence_(linkedImage.text)), ['[[IMAGE_1]]', '[[LINK_1]]']);
const circularImage = sandbox.htmlToImageAwareText_('<img src="https://cdn.example.org/oracle.jpg" width="700" height="700" alt="Oracle">', 8);
assert.strictEqual(circularImage.images[0].circular, true);
assert.strictEqual(circularImage.images[0].originalUrl, 'https://cdn.example.org/oracle.jpg');
assert(circularImage.images[0].url.includes('mask=circle'));
assert(circularImage.images[0].url.includes('output=jpg'));
assert(circularImage.images[0].url.includes('mbg=ffffff'));
const fourteenLinksHtml = Array.from({ length: 14 }, (_, i) => `<a href="https://steverother.org/item-${i + 1}">Useful item ${i + 1}</a>`).join('\n');
const fourteenLinks = sandbox.htmlToImageAwareText_(fourteenLinksHtml, 8, 30);
assert.strictEqual(fourteenLinks.links.length, 14);
assert(fourteenLinks.text.includes('[[LINK_14]]'));
const styled = sandbox.htmlToImageAwareText_('<h5>Important heading</h5><p>Normal <strong>bold</strong> and <em>italic</em>.</p><a style="font-weight:700;font-style:italic" href="https://steverother.org/styled">Styled link</a>', 8, 30);
assert(styled.text.includes('[[B]] Important heading [[/B]]'));
assert(styled.text.includes('[[B]] bold [[/B]]'));
assert(styled.text.includes('[[I]] italic [[/I]]'));
assert.deepStrictEqual(Array.from(sandbox.protectedMarkerSequence_(styled.text)).slice(-5), ['[[B]]', '[[I]]', '[[LINK_1]]', '[[/I]]', '[[/B]]']);
assert.strictEqual(sandbox.telegramTextHtml_('A [[B]]bold[[/B]] and [[I]]italic[[/I]] [[LINK_1]]', styled.links), 'A <b>bold</b> and <i>italic</i> <a href="https://steverother.org/styled">Styled link</a>');

const markerPost = sandbox.ensureImageMarkers_('Intro\n\n[[IMAGE_1]]\n\nClosing', imageAware.images);
assert.strictEqual((markerPost.match(/\[\[IMAGE_1\]\]/g) || []).length, 1);
assert.strictEqual((markerPost.match(/\[\[IMAGE_2\]\]/g) || []).length, 1);
const rebalancedPost = sandbox.ensureImageMarkers_('Intro\n\nMiddle\n\nClosing\n\n[[IMAGE_1]]\n\n[[IMAGE_2]]', imageAware.images);
assert(!/\[\[IMAGE_1\]\]\s*\[\[IMAGE_2\]\]\s*$/.test(rebalancedPost));
assert(rebalancedPost.indexOf('[[IMAGE_1]]') < rebalancedPost.indexOf('Middle'));
assert(rebalancedPost.indexOf('[[IMAGE_2]]') < rebalancedPost.indexOf('Closing'));
const directLink = linked.links.find(link => link.url === 'https://steverother.org/event');
const editorialLink = { marker: '[[LINK_1]]', url: directLink.url, label: directLink.label };
const linkPost = sandbox.ensureLinkMarkers_(markerPost + '\n\nEvent [[LINK_1]]', [editorialLink]);
assert.strictEqual((linkPost.match(/\[\[LINK_1\]\]/g) || []).length, 1);
const duplicateLabelPost = sandbox.ensureLinkMarkers_('Read Event details [[LINK_1]] now.', [editorialLink]);
assert.strictEqual(duplicateLabelPost, 'Read [[LINK_1]] now.');
const duplicateLabelHtml = sandbox.richTextWithLinks_(duplicateLabelPost, [editorialLink]);
assert.strictEqual((duplicateLabelHtml.match(/Event details/g) || []).length, 1);
const urlOnlyLink = { marker: '[[LINK_9]]', url: 'https://example.org', label: 'https://example.org' };
assert.strictEqual(sandbox.expandLinkMarkers_('Visit [[LINK_9]]', [urlOnlyLink]), 'Visit https://example.org');
assert.deepStrictEqual(Array.from(sandbox.protectedMarkerSequence_('A [[IMAGE_1]] B [[LINK_2]]')), ['[[IMAGE_1]]', '[[LINK_2]]']);
assert.doesNotThrow(() => sandbox.assertFaithfulMarkerStructure_('[[IMAGE_1]] x [[LINK_1]]', 'copy [[IMAGE_1]] text [[LINK_1]]'));
assert.throws(() => sandbox.assertFaithfulMarkerStructure_('[[IMAGE_1]] [[LINK_1]]', '[[LINK_1]] [[IMAGE_1]]'), /changed the newsletter image\/link order/);
assert.throws(() => sandbox.assertFaithfulMarkerStructure_('[[IMAGE_1]] [[LINK_1]]', '[[IMAGE_1]] [[LINK_1]] [[LINK_1]]'), /duplicated\/omitted/);
const fallbackItems = sandbox.buildFallbackPublicationItems_(linkPost, imageAware.images, 3800, [editorialLink]);
assert.deepStrictEqual(Array.from(fallbackItems, item => item.type), ['text', 'photo', 'text', 'photo', 'text']);
assert.strictEqual(fallbackItems[0].text, 'Intro');
assert.strictEqual(fallbackItems[1].url, 'https://cdn.example.org/hero.jpg');
assert.strictEqual(fallbackItems[3].url, 'https://cdn.example.org/second.jpg');
assert(fallbackItems[4].text.includes('https://steverother.org/event'));
const transparentItems = sandbox.buildFallbackPublicationItems_('Before\n\n[[IMAGE_1]]\n\nAfter', circularImage.images, 3800, []);
assert.deepStrictEqual(Array.from(transparentItems, item => item.type), ['text', 'photo', 'text']);
assert.strictEqual(
  sandbox.normalizeTelegramSpacing_('[[B]]Heading[[/B]]\nParagraph\n[[IMAGE_1]]\nNext'),
  '[[B]]Heading[[/B]]\n\nParagraph\n\n[[IMAGE_1]]\n\nNext'
);

const richHtml = sandbox.buildTelegramRichHtml_(linkPost, imageAware.images, [editorialLink]);
assert(richHtml.includes('<img src="https://cdn.example.org/hero.jpg"/>'));
assert(richHtml.includes('<a href="https://steverother.org/event">Event details</a>'));
assert(!richHtml.includes('[[LINK_'));

const chunks = sandbox.splitTelegram_('A'.repeat(100) + '\n\n' + 'B'.repeat(100), 120);
assert.strictEqual(chunks.length, 2);
assert(chunks.every(x => x.length <= 120));

const trimmed = sandbox.intelligentlyTrim_('First sentence. ' + 'x'.repeat(200), 80);
assert(trimmed.length <= 80);
assert(trimmed.endsWith('…'));

assert.strictEqual(sandbox.isTrackingUrl_('https://click.mlsend.com/a'), true);
assert.strictEqual(sandbox.isTrackingUrl_('https://links.mailerlite.com/a'), true);
assert.strictEqual(sandbox.isTrackingUrl_('https://steverother.org/a'), false);
assert(!sandbox.stripTrackingUrlsFromPost_('Read https://click.mlsend.com/a now').includes('mlsend.com'));
const originalPreview = sandbox.sanitizeOriginalEmailPreview_('<html><head><style>.cta{background:#b4a985}</style></head><body><a class="cta" href="https://click.mlsend.com/a">Book now</a><img class="open_img" width="1" height="1" src="https://click.mlsend.com/o"></body></html>');
assert(originalPreview.includes('background:#b4a985'));
assert(originalPreview.includes('Book now'));
assert(originalPreview.includes('href="#"'));
assert(!originalPreview.includes('open_img'));

const hostilePreview = sandbox.sanitizeOriginalEmailPreview_(`<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><style>@import url(https://evil.example/x.css);</style></head><body onload="alert(1)">
<script>alert(2)</script><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="a"></form>
<a href='https://click.mlsend.com/x' target="_blank" onclick="x()">Go</a><button>Send</button>
<img class="open_img" width="1" height="1" src="https://t.example/o"><object data="x"></object><embed src="y">
<img src="https://cdn.example.org/photo.jpg" width="640" height="360"></body></html>`);
assert(!/<script|<iframe|<form|<input|<button|<object|<embed|http-equiv|@import|onload|onclick|target=/i.test(hostilePreview));
assert(hostilePreview.includes('<a href="#">Go</a>'));
assert(hostilePreview.includes('src="https://cdn.example.org/photo.jpg"'));
assert(!hostilePreview.includes('t.example'));

const canonicalSignedPreview = {
  messageId: 'gmail-1',
  proposedPost: 'Hello [[IMAGE_1]] [[LINK_1]]',
  images: [{ marker: '[[IMAGE_1]]', url: 'https://cdn.example.org/a.png', originalUrl: undefined, alt: undefined, circular: false, width: 640 }],
  links: [{ marker: '[[LINK_1]]', url: 'https://example.org', label: 'Read more', ignored: 'browser-only' }]
};
const browserRoundTrip = JSON.parse(JSON.stringify(canonicalSignedPreview));
assert.deepStrictEqual(sandbox.canonicalTestPreview_(canonicalSignedPreview), sandbox.canonicalTestPreview_(browserRoundTrip));
assert.strictEqual(sandbox.signTestPreview_(canonicalSignedPreview), sandbox.signTestPreview_(browserRoundTrip));
assert.strictEqual(sandbox.digest_('same'), sandbox.digest_('same'));
assert.notStrictEqual(sandbox.digest_('same'), sandbox.digest_('different'));

const signedPreview = {
  messageId: 'message-1',
  proposedPost: linkPost,
  images: imageAware.images,
  links: [editorialLink]
};
assert.strictEqual(sandbox.signTestPreview_(signedPreview), sandbox.signTestPreview_(signedPreview));
assert.notStrictEqual(
  sandbox.signTestPreview_(signedPreview),
  sandbox.signTestPreview_(Object.assign({}, signedPreview, { proposedPost: linkPost + ' changed' }))
);

// Fidelity: the rich and fallback publishing payloads must keep source order,
// send each image and link once, and leave no protected markers behind.
const sentRequests = [];
sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: key => ({ TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '-100' })[key] || null, setProperty: () => {} }) };
sandbox.UrlFetchApp = { fetch: (url, options) => {
  sentRequests.push({ url, payload: JSON.parse(options.payload) });
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: { message_id: sentRequests.length } }) };
} };
const fidelityEmail = '<html><body><h1>Walking Each Other Home</h1><p>A <b>warm</b> and useful teaching on grief.</p>' +
  '<img src="https://cdn.example.org/grief-banner.jpg" width="640" height="320" alt="Banner">' +
  '<p>Join us on <a href="https://steverother.org/event">the event page</a> this Sunday.</p>' +
  '<img src="https://cdn.example.org/oracle.jpg" width="700" height="700" alt="Oracle">' +
  '<p>Second paragraph after the circle.</p></body></html>';
const fidelityExtract = sandbox.htmlToImageAwareText_(fidelityEmail, 8, 30);
let fidelityPost = sandbox.ensureImageMarkers_(fidelityExtract.text, fidelityExtract.images);
fidelityPost = sandbox.ensureLinkMarkers_(fidelityPost, fidelityExtract.links);
sandbox.telegramTrySendRich_(fidelityPost, fidelityExtract.images, fidelityExtract.links);
const fidelityHtml = sentRequests[sentRequests.length - 1].payload.rich_message.html;
assert.strictEqual((fidelityHtml.match(/<img /g) || []).length, fidelityExtract.images.length);
assert.strictEqual((fidelityHtml.match(/Second paragraph after the circle/g) || []).length, 1);
['Walking Each Other Home', 'grief-banner.jpg', 'the event page', 'oracle.jpg', 'Second paragraph'].reduce((from, token) => {
  const at = fidelityHtml.indexOf(token);
  assert(at > from, 'source order broken at ' + token);
  return at;
}, -1);
assert(fidelityHtml.includes('<a href="https://steverother.org/event">'));
assert(fidelityHtml.includes('<b> Walking Each Other Home </b><br><br>A <b> warm </b>'), 'blank line after heading must be carried across');
assert(!fidelityHtml.includes('<p>'), 'rich post must carry blank lines as explicit breaks');
const fidelityItems = sandbox.buildFallbackPublicationItems_(fidelityPost, fidelityExtract.images, 3800, fidelityExtract.links);
assert.deepStrictEqual(fidelityItems.filter(item => item.type !== 'text').map(item => item.url), fidelityExtract.images.map(image => image.url));
assert(!/\[\[(?:IMAGE|LINK)_\d+\]\]/.test(fidelityHtml + JSON.stringify(fidelityItems)));

console.log('All local helper tests passed.');

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(__dirname + '/Code.gs', 'utf8');
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
const fallbackItems = sandbox.buildFallbackPublicationItems_(linkPost, imageAware.images, 3800, [editorialLink]);
assert.deepStrictEqual(Array.from(fallbackItems, item => item.type), ['text', 'photo', 'text', 'photo', 'text']);
assert.strictEqual(fallbackItems[0].text, 'Intro');
assert.strictEqual(fallbackItems[1].url, 'https://cdn.example.org/hero.jpg');
assert.strictEqual(fallbackItems[3].url, 'https://cdn.example.org/second.jpg');
assert(fallbackItems[4].text.includes('https://steverother.org/event'));

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

console.log('All local helper tests passed.');

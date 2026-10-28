// Renders what the publisher would send to Telegram, beside the source email,
// so layout and content can be checked and iterated without a live Telegram chat.
//
// Usage: node tools/telegram-preview/render.js [sample.html] [outDir]
// Output: email.png (source), telegram-rich.png (the post the publisher sends first, via
//         sendRichMessage; approximated in Telegram styling), telegram-ordered.png (the
//         sendMessage/sendPhoto fallback used only if the rich request is rejected).
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..', '..');
const samplePath = path.resolve(process.argv[2] || path.join(__dirname, 'sample-email.html'));
const outDir = path.resolve(process.argv[3] || path.join(__dirname, 'out'));
fs.mkdirSync(outDir, { recursive: true });

// Load the real publishing code with Telegram/Gmail stubbed out; nothing is sent.
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, computeDigest: () => [], base64EncodeWebSafe: () => '' }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(repo, 'Code.gs'), 'utf8'), sandbox);

const email = fs.readFileSync(samplePath, 'utf8');
const extracted = sandbox.htmlToImageAwareText_(email, 8, 30);
let post = sandbox.ensureImageMarkers_(extracted.text, extracted.images);
post = sandbox.ensureLinkMarkers_(post, extracted.links);
const images = extracted.images;
const links = extracted.links;

// Placeholder artwork at the source's real proportions. Circles are drawn as
// Telegram would show a flattened cut-out (white corners).
function placeholder(image) {
  const w = Number(image.width || 640), h = Number(image.height || 320);
  const shape = image.circular ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="#7a6aa8"/>` : `<rect width="${w}" height="${h}" fill="#7a6aa8"/>`;
  const label = image.circular ? 'circle' : 'banner';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${shape}<text x="50%" y="50%" fill="#fff" font-size="${Math.round(h / 8)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label} ${w}x${h}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
const sizeByMarker = {};
images.forEach(image => { sizeByMarker[image.marker] = image; });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Telegram sendMessage HTML (text) and sendPhoto/sendDocument (images), as published.
const items = sandbox.buildFallbackPublicationItems_(post, images, 3800, links);
const orderedBubbles = items.map(item => {
  if (item.type === 'text') return `<div class="bubble"><div class="text">${item.text.replace(/\n/g, '<br>')}</div><div class="time">13:53</div></div>`;
  if (item.type === 'photo') {
    const image = images.find(candidate => candidate.url === item.url) || {};
    return `<div class="bubble media"><img src="${placeholder(image)}"><div class="time">13:53</div></div>`;
  }
  return '';
}).join('\n');

// sendRichMessage approximation: one post with the rich HTML, images placed inline.
const richHtml = sandbox.buildTelegramRichHtml_(post, images, links)
  .replace(/<img src="([^"]+)"\/>/g, (match, escapedUrl) => {
    const url = escapedUrl.replace(/&amp;/g, '&');
    const image = images.find(candidate => candidate.url === url) || {};
    return `<img src="${placeholder(image)}">`;
  });

const css = `
  body{margin:0;font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;background:#0e1621;color:#fff}
  .chat{width:390px;padding:12px 12px 24px;box-sizing:border-box}
  .bubble{background:#182533;border-radius:14px;padding:8px 10px 6px;margin:6px 0;max-width:360px;font-size:16px;line-height:1.35;position:relative}
  .bubble.media{padding:4px}
  .bubble.media img{display:block;width:100%;border-radius:10px}
  .bubble.file{display:flex;gap:10px;align-items:center}
  .fileicon{width:44px;height:44px;border-radius:8px;background:#2b5278}
  .fname{color:#6ab3f3}.fsize{color:#7f91a4;font-size:13px}
  .text a{color:#6ab3f3}
  .text b{font-weight:700}
  .time{color:#7f91a4;font-size:12px;text-align:right;margin-top:2px}
  .rich{background:#182533;border-radius:14px;padding:10px 12px;max-width:360px;font-size:16px;line-height:1.4}
  .rich img{display:block;width:100%;border-radius:10px;margin:8px 0}
  .rich p{margin:0 0 10px}
  .rich a{color:#6ab3f3}
  .email{background:#fff;color:#111;width:640px;padding:20px;box-sizing:border-box;font-family:Georgia,serif}
  .email img{max-width:100%}
  .email a{color:#1a73e8}
  .heading{font:600 14px sans-serif;color:#aaa;padding:6px 0}
`;
const page = (title, body, width) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="chat" style="width:${width}px"><div class="heading">${title}</div>${body}</div></body></html>`;

const emailHtml = email.replace(/<img([^>]*)src="([^"]+)"/g, (match, attrs, url) => {
  const image = images.find(candidate => candidate.originalUrl === url || candidate.url === url) || { width: 640, height: 320 };
  return `<img${attrs}src="${placeholder(image)}"`;
});

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
  const shots = [
    ['email.png', page('Source email', `<div class="email">${emailHtml}</div>`, 680)],
    ['telegram-rich.png', page('Telegram: rich post (sendRichMessage, approximated)', `<div class="rich">${richHtml}</div>`, 390)],
    ['telegram-ordered.png', page('Telegram: fallback sequence (only if rich is rejected)', orderedBubbles, 390)]
  ];
  for (const [name, html] of shots) {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log('wrote ' + ['email.png', 'telegram-rich.png', 'telegram-ordered.png'].map(name => path.join(outDir, name)).join('\n'));
})();

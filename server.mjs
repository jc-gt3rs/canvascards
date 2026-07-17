import http from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
const cardsFile = join(dataDir, 'cards.json');
const sessionsDir = join(dataDir, 'sessions');
const port = Number(process.env.PORT || 8787);

async function cards() {
  if (!existsSync(cardsFile)) return [];
  return JSON.parse(await readFile(cardsFile, 'utf8'));
}
async function save(items) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(cardsFile, JSON.stringify(items, null, 2));
}
async function sessions() {
  if (!existsSync(sessionsDir)) return [];
  const files = (await readdir(sessionsDir)).filter(file => file.endsWith('.json'));
  const items = await Promise.all(files.map(file => readFile(join(sessionsDir, file), 'utf8').then(JSON.parse)));
  return items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}
async function saveSessions(items) {
  await mkdir(sessionsDir, { recursive: true });
  await Promise.all(items.map(item => writeFile(join(sessionsDir, `${item.id}.json`), JSON.stringify(item, null, 2))));
}
async function body(req) {
  let raw = '';
  for await (const piece of req) raw += piece;
  return raw ? JSON.parse(raw) : {};
}
const copyCards = items => JSON.parse(JSON.stringify(items));
const sessionSummary = item => ({ id: item.id, name: item.name, cardCount: item.cards.length, updatedAt: item.updatedAt });
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      return send(res, 200, (await sessions()).map(sessionSummary));
    }
    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      const { name } = await body(req);
      if (!name?.trim()) return send(res, 400, { error: 'Session name is required.' });
      const item = { id: crypto.randomUUID(), name: name.trim(), cards: copyCards(await cards()), updatedAt: new Date().toISOString() };
      const current = await sessions();
      await saveSessions([item, ...current]);
      return send(res, 201, item);
    }
    if (url.pathname === '/api/sessions/new' && req.method === 'POST') {
      await save([]);
      return send(res, 200, { cards: [] });
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(load))?$/);
    if (sessionMatch) {
      const [, id, action] = sessionMatch;
      const current = await sessions();
      const item = current.find(entry => entry.id === id);
      if (!item) return send(res, 404, { error: 'Session not found.' });
      if (req.method === 'GET' && !action) return send(res, 200, item);
      if (req.method === 'POST' && action === 'load') {
        await save(copyCards(item.cards));
        return send(res, 200, { session: sessionSummary(item), cards: copyCards(item.cards) });
      }
      if (req.method === 'PUT' && !action) {
        const { name } = await body(req);
        if (name !== undefined && !name.trim()) return send(res, 400, { error: 'Session name is required.' });
        if (name !== undefined) item.name = name.trim();
        item.cards = copyCards(await cards());
        item.updatedAt = new Date().toISOString();
        await saveSessions(current);
        return send(res, 200, item);
      }
      if (req.method === 'PATCH' && !action) {
        const { name } = await body(req);
        if (!name?.trim()) return send(res, 400, { error: 'Session name is required.' });
        item.name = name.trim();
        item.updatedAt = new Date().toISOString();
        await saveSessions(current);
        return send(res, 200, sessionSummary(item));
      }
    }
    if (url.pathname === '/api/cards' && req.method === 'GET') return send(res, 200, await cards());
    if (url.pathname === '/api/cards' && req.method === 'DELETE') {
      await save([]);
      return send(res, 204, '');
    }
    // POST alias keeps the action reliable in browsers/extensions that
    // restrict DELETE requests from local pages.
    if (url.pathname === '/api/cards/clear' && req.method === 'POST') {
      await save([]);
      return send(res, 204, '');
    }
    if (url.pathname === '/api/import' && req.method === 'POST') {
      const incoming = (await body(req)).cards || [];
      const current = await cards();
      const known = new Set(current.map(c => `${c.front}|${c.back}`));
      const fresh = incoming.filter(c => c.front && c.back && !known.has(`${c.front}|${c.back}`))
        .map(c => ({ id: crypto.randomUUID(), front: c.front.trim(), back: c.back.trim(), source: c.source || 'Canvas', status: 'new', createdAt: new Date().toISOString() }));
      await save([...fresh, ...current]);
      return send(res, 201, { imported: fresh.length });
    }
    if (url.pathname.startsWith('/api/cards/') && req.method === 'DELETE') {
      const id = url.pathname.split('/').pop();
      await save((await cards()).filter(c => c.id !== id));
      return send(res, 204, '');
    }
    if (url.pathname.startsWith('/api/cards/') && req.method === 'PATCH') {
      const id = url.pathname.split('/').pop();
      const { status } = await body(req);
      if (!['new', 'known', 'dont_know'].includes(status)) return send(res, 400, { error: 'Invalid card status.' });
      const current = await cards();
      const card = current.find(c => c.id === id);
      if (!card) return send(res, 404, { error: 'Card not found.' });
      card.status = status;
      await save(current);
      return send(res, 200, card);
    }
    if (url.pathname === '/api/cards' && req.method === 'POST') {
      const { front, back } = await body(req);
      if (!front?.trim() || !back?.trim()) return send(res, 400, { error: 'Both sides are required.' });
      const card = { id: crypto.randomUUID(), front: front.trim(), back: back.trim(), source: 'Manual', status: 'new', createdAt: new Date().toISOString() };
      await save([card, ...(await cards())]); return send(res, 201, card);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'API route not found. Restart the local server with npm start.' });
    const file = url.pathname === '/' ? 'app/index.html' : `app${url.pathname}`;
    const path = join(root, file);
    if (!path.startsWith(join(root, 'app'))) return send(res, 403, { error: 'Forbidden' });
    return send(res, 200, await readFile(path), mime[extname(path)] || 'text/plain');
  } catch (error) { return send(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message }); }
}).listen(port, () => console.log(`Flashcards are running at http://localhost:${port}`));

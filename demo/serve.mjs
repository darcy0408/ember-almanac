// Serves this folder at http://localhost:8799 so the narration page can use the microphone.
//   npm run demo
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.js': 'text/javascript', '.mjs': 'text/javascript' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '') || 'index.html';
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(8799, () => console.log('Narration page: http://localhost:8799'));

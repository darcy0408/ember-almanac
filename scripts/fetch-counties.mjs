// Downloads US county boundaries (TopoJSON, 10m) into public/data/.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'counties-10m.json');

const res = await fetch(URL_);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
JSON.parse(buf.toString('utf8')); // sanity check
await mkdir(dirname(out), { recursive: true });
await writeFile(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const app = process.argv[2];
if (!app) throw new Error('Podaj katalog repozytorium aplikacji');
const source = await readFile(new URL('./temporal.mjs', import.meta.url), 'utf8');
await mkdir(path.join(app, 'src/content'), { recursive: true });
await writeFile(path.join(app, 'src/content/temporal.js'), source);
console.log('Zsynchronizowano kontrakt czasowy z aplikacją.');

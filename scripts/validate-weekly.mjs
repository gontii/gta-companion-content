#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { validateContent } from './generate-weekly.mjs';

async function validateFile(file) {
  const content = JSON.parse(await readFile(file, 'utf8'));
  validateContent(content);
  return content.weekId;
}

async function main() {
  const files = process.argv.slice(2);
  const targets =
    files.length > 0
      ? files
      : (await readdir('weekly'))
          .filter((file) => file.endsWith('.json'))
          .map((file) => path.join('weekly', file));

  for (const file of targets) {
    const weekId = await validateFile(file);
    console.log(`valid ${file} (${weekId})`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

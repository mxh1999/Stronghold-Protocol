// Reapply extension translations after merging upstream language packs.
import { readFile, writeFile } from 'node:fs/promises';
const dictionary = JSON.parse(await readFile(new URL('./i18n.json', import.meta.url), 'utf8'));
for (const [index, code] of ['en', 'ja', 'ko', 'zh-TW'].entries()) {
  const file = new URL(`../../public/i18n/${code}.json`, import.meta.url);
  const pack = JSON.parse(await readFile(file, 'utf8'));
  for (const [key, values] of Object.entries(dictionary)) if (!(key in pack)) pack[key] = values[index];
  await writeFile(file, JSON.stringify(pack, null, 2) + '\n');
}

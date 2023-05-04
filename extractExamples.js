const fs = require('fs');

try {
  fs.rmSync('./examples', { recursive: true });
} catch {
  // ¯\_(ツ)_/¯
}
fs.mkdirSync('./examples');

const TICK = '  await new Promise((resolve) => setTimeout(resolve, 0));';

const codeBlocks = fs
  .readFileSync('./readme.md', 'utf8')
  .matchAll(/(<!--(?<id>.*?)-->)?\n*```ts(?<code>(.|\n)*?)```/gm);

Array.from(codeBlocks).forEach(({ groups }, index) => {
  const id = groups?.id?.trim()?.replace(/\s/g, '-') || `example-${index}`;
  const code = groups?.code.trim();
  if (id === 'ignore' || !code) {
    return;
  }

  const importRegex =
    /^import\s+(?:{[^}]*}|[\w*]+)\s+from\s+['"][^'"]+['"];\s*$/gm;
  let imports =
    code
      .match(importRegex)
      ?.join('\n')
      .replace(/from ('|")cachified('|");/, 'from $1../src/index$2;') || '';

  if (index === 3) {
    imports = imports.replace(/from ('|")redis('|");/, 'from $1redis4$2;');
  }

  let restOfTheCode = code
    .replace(importRegex, '')
    .trim()
    .replace(/\n/gm, '\n  ')
    .replace(
      /\/\/ (\d+) seconds? later/gm,
      (_, seconds) => `time.current += ${seconds} * 1000;\n${TICK}`,
    )
    .replace(
      /\/\/ (\d+) minutes? later/gm,
      (_, minutes) => `time.current += ${minutes} * 60_000;\n${TICK}`,
    );

  fs.writeFileSync(
    `./examples/${id}.ts`,
    `${imports}
interface Opts {
  console?: Console;
  fetch?: typeof global.fetch;
  time?: { current: number };
}
export default async function run({
  console = global.console,
  fetch = global.fetch,
  time = { current: 0 },
}: Opts = {}) {
  ${restOfTheCode}
  ${restOfTheCode.includes('const cache =') ? 'return cache' : ''}
}`,
  );
});

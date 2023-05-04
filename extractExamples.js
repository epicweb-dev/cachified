const codedown = require('codedown');
const fs = require('fs');

try {
  fs.rmSync('./examples', { recursive: true });
} catch {
  // ¯\_(ツ)_/¯
}
fs.mkdirSync('./examples');

const SEPERATOR = '-------------SEPERATOR-------------';
const TICK = '  await new Promise((resolve) => setTimeout(resolve, 0));';

codedown(fs.readFileSync('./readme.md', 'utf8'), 'ts', SEPERATOR)
  .split(SEPERATOR)
  .filter(Boolean)
  .forEach((code, index) => {
    if (index === 1) {
      return;
    }

    const importRegex =
      /^import\s+(?:{[^}]*}|[\w*]+)\s+from\s+['"][^'"]+['"];\s*$/gm;
    let imports = code
      .match(importRegex)
      .join('\n')
      .replace(/from ('|")cachified('|");/, 'from $1../src/index$2;');

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
      './examples/example' + index + '.ts',
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

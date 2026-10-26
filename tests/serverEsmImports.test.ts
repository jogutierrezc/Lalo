import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// En Vercel el servidor corre como ESM de Node: un import relativo sin «.js» no se resuelve
// y tira abajo la función entera. Esta prueba recorre server/ y api/ y lo impide.

const ROOT = process.cwd();

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]*)['"]/gm;

describe('imports relativos de server/ y api/', () => {
  it('todos llevan extensión .js (o .json)', () => {
    const bad: string[] = [];
    for (const dir of ['server', 'api']) {
      for (const file of files(join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(SPEC)) {
          if (!/\.(js|json)$/.test(match[1])) bad.push(`${file.slice(ROOT.length + 1)}: ${match[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('botDb.ts no importa nada de src/ salvo tipos', () => {
    const text = readFileSync(join(ROOT, 'server/twitch/botDb.ts'), 'utf8');
    const runtime = [...text.matchAll(/^import\s+(?!type\b)[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(runtime.filter((spec) => spec.includes('/src/'))).toEqual([]);
  });
});

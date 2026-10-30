// Runs scripts/verify-worker.mjs on a Node build that has no TypeScript stripping
// (this host reports ERR_NO_TYPESCRIPT). It transpiles the three lib modules the
// worker imports with the TypeScript API, rewrites the .ts import specifiers, and
// then imports the worker unchanged — the worker stays the single source of truth.
//
//   node scripts/run-verify-worker.mjs
//
// Used by deploy/civicresolve-verify.timer; equivalent to
//   node --experimental-strip-types scripts/verify-worker.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, '.verify-build')
const require = createRequire(path.join(ROOT, 'node_modules/'))
const ts = require('typescript')

// The worker is launched without --env-file, so load .env ourselves
if (fs.existsSync(path.join(ROOT, '.env'))) {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const key = t.slice(0, i).trim()
    if (!process.env[key]) process.env[key] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const MODULES = ['imagery', 'ollama', 'verify-core', 'duplicate-vision']
for (const name of MODULES) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', `${name}.ts`), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  fs.writeFileSync(path.join(OUT, `${name}.mjs`), js.replace(/from '\.\/([\w-]+)\.ts'/g, "from './$1.mjs'"))
}

const worker = fs
  .readFileSync(path.join(ROOT, 'scripts/verify-worker.mjs'), 'utf8')
  .replace(/from '\.\.\/lib\/([\w-]+)\.ts'/g, "from './$1.mjs'")
fs.writeFileSync(path.join(OUT, 'worker.mjs'), worker)

await import(pathToFileURL(path.join(OUT, 'worker.mjs')).href)

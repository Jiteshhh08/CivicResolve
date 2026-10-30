import type { NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Serves user uploads from disk.
 *
 * The app runs with `output: 'standalone'`, and Next freezes the public/ file
 * listing at build time — anything written to public/uploads afterwards (i.e.
 * every citizen photo and every resolution proof) is a 404 from the static
 * handler. This route reads the file at request time instead.
 */

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads')

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: segments } = await context.params
  if (!segments?.length) {
    return new Response('Not found', { status: 404 })
  }

  const target = path.resolve(UPLOAD_ROOT, ...segments)
  // Reject anything that escapes the upload root (../, absolute paths, symlink-ish input)
  if (target !== UPLOAD_ROOT && !target.startsWith(UPLOAD_ROOT + path.sep)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const file = await readFile(target)
    const ext = path.extname(target).toLowerCase()
    return new Response(new Uint8Array(file), {
      headers: {
        'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        // Filenames contain a timestamp, so a file is never rewritten in place
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

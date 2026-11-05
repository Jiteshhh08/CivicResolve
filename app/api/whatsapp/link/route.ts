import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getAuthUser } from '@/lib/auth-utils'
import { db } from '@/lib/database'

// 6 chars, no 0/O/1/I so citizens can read them off a screen and retype.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TTL_MIN = 15
const MAX_PER_HOUR = 5
const BOT = process.env.WHATSAPP_PUBLIC_NUMBER || '+1 555 153 4991'

function makeCode() {
  return Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('')
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const rows: any = await db.query(
    'SELECT phone FROM users WHERE id = ? LIMIT 1' as any, [user.id], 'select'
  )
  const phone = rows?.[0]?.phone || null
  return NextResponse.json({ linked: !!phone, phone, botNumber: BOT })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const recent: any = await db.query(
    'SELECT COUNT(*) AS n FROM wa_link_codes WHERE user_id = ? AND created_at > (NOW() - INTERVAL 1 HOUR)' as any,
    [user.id], 'select'
  )
  if (Number(recent?.[0]?.n || 0) >= MAX_PER_HOUR) {
    return NextResponse.json({ error: 'Too many codes requested. Try again in an hour.' }, { status: 429 })
  }

  // one live code per account
  await db.query('DELETE FROM wa_link_codes WHERE user_id = ? AND used_at IS NULL' as any, [user.id], 'delete')

  const code = makeCode()
  await db.query(
    'INSERT INTO wa_link_codes (code, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))' as any,
    [code, user.id, TTL_MIN], 'insert'
  )

  return NextResponse.json({ code, expiresAt: new Date(Date.now() + TTL_MIN * 60_000).toISOString(), botNumber: BOT })
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  await db.query('UPDATE users SET phone = NULL WHERE id = ?' as any, [user.id], 'update')
  return NextResponse.json({ linked: false })
}

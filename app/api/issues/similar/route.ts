import { NextRequest, NextResponse } from 'next/server'
import { DuplicateDetection } from '@/lib/duplicate-detection'
import { db } from '@/lib/database'
import { rateLimiters } from '@/lib/rate-limiter'

// Pre-submit check: the same engine POST /api/issues uses as its gate, called
// while the citizen is still typing so they see overlapping complaints first.
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'anonymous'

  if (!rateLimiters.general.check(ip, 'issues/similar').allowed) {
    return NextResponse.json({ matches: [] }, { status: 429 })
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ matches: [] })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const category = typeof body.category === 'string' ? body.category : ''
  const latitude = Number(body.latitude)
  const longitude = Number(body.longitude)

  // Nothing to compare yet: not enough text, no category, or no location.
  if (title.length < 8 || !category || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ matches: [], skipped: true })
  }

  try {
    const result = await DuplicateDetection.detectDuplicates({
      title,
      description,
      category,
      latitude,
      longitude,
    })

    const matches = result.possibleDuplicates.slice(0, 3).map((d) => ({
      id: d.issueId,
      title: d.title,
      status: d.status,
      address: d.address,
      distanceMeters: d.distanceMeters,
      score: d.similarityScore,
      votes: d.votes_count,
    }))

    if (matches.length > 0) return NextResponse.json({ matches, count: matches.length })

    // Nothing scored as a duplicate, but a citizen still deserves to see what is
    // already reported on their street. Same category, ~1.5 km, open cases only.
    const nearby = await db.query<any[]>(
      `SELECT id, title, status, address,
              6371000 * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS(latitude - ?) / 2), 2) +
                COS(RADIANS(?)) * COS(RADIANS(latitude)) *
                POWER(SIN(RADIANS(longitude - ?) / 2), 2)
              )) AS distance_m
         FROM issues
        WHERE category = ?
          AND status NOT IN ('RESOLVED', 'REJECTED', 'CLOSED_DUPLICATE')
          AND created_at >= NOW() - INTERVAL 90 DAY
        HAVING distance_m <= 1500
        ORDER BY distance_m ASC
        LIMIT 3`,
      [latitude, latitude, longitude, category]
    )

    return NextResponse.json({
      matches: (nearby || []).map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        address: m.address,
        distanceMeters: Math.round(Number(m.distance_m)),
        score: 0,
        votes: 0,
      })),
      fallback: true,
      count: (nearby || []).length,
    })
  } catch {
    return NextResponse.json({ matches: [] })
  }
}

// Portal → WhatsApp bridge. Fire-and-forget by design: a messaging failure must
// never fail the request that caused it, but it is always logged.

const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:3320';
const KEY = process.env.BRIDGE_API_KEY || '';

const digits = (p: string) => String(p || '').replace(/\D/g, '');

export async function sendWhatsApp(phone: string | null | undefined, text: string): Promise<boolean> {
  const to = digits(phone || '');
  if (to.length < 10) return false;
  try {
    const res = await fetch(`${BRIDGE}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ phone: to, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[whatsapp] notify ${to} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] notify ${to} threw:`, (err as Error).message);
    return false;
  }
}

const STATUS_COPY: Record<string, string> = {
  PENDING: 'is queued for review',
  IN_PROGRESS: 'is being worked on',
  RESOLVED: 'has been marked resolved',
  REJECTED: 'was closed as invalid',
};

export async function notifyStatusChange(phone: string | null | undefined, issueId: number, title: string, status: string) {
  const copy = STATUS_COPY[status] || `is now ${status.replace(/_/g, ' ').toLowerCase()}`;
  return sendWhatsApp(phone, `🔔 CivicResolve update\n\n*#${issueId} ${title}* ${copy}.\n\nReply *status ${issueId}* for the latest.`);
}

"use client"

import { useEffect, useState } from "react"
import { MessageCircle, Copy, Check, Loader2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type LinkState = { linked: boolean; phone: string | null; botNumber: string }

export function WhatsAppLinkCard() {
  const [state, setState] = useState<LinkState | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch("/api/whatsapp/link")
      if (res.ok) setState(await res.json())
    } catch {
      setError("Could not load WhatsApp status")
    }
  }

  useEffect(() => { load() }, [])

  const generate = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch("/api/whatsapp/link", { method: "POST" })
      const data = await res.json()
      if (!res.ok) setError(data.error || "Could not create a code")
      else { setCode(data.code); setState((s) => (s ? { ...s, botNumber: data.botNumber } : s)) }
    } catch {
      setError("Could not create a code")
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/link", { method: "DELETE" })
      if (res.ok) { setState((s) => (s ? { ...s, linked: false, phone: null } : s)); setCode(null) }
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!code) return
    await navigator.clipboard.writeText(`link ${code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border-0 bg-white/80 backdrop-blur-sm shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-600" />
          WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!state ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : state.linked ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Linked number</p>
                <p className="font-medium text-gray-900">+{state.phone}</p>
              </div>
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Connected</Badge>
            </div>
            <p className="text-xs text-gray-500">
              Reports you send on WhatsApp appear here, and we message you when an issue changes status. To file one, send a photo of the problem and its location pin.
            </p>
            <Button variant="outline" size="sm" onClick={unlink} disabled={busy} className="w-full">
              <Unlink className="h-4 w-4 mr-2" /> Disconnect
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Reporting on WhatsApp needs a linked account. Link your number here, then send a photo of the problem and its location pin. Checking the status of a report needs no account.
            </p>
            {code ? (
              <>
                <p className="text-sm text-gray-600">
                  Open WhatsApp, message <span className="font-medium">{state.botNumber}</span> and send:
                </p>
                <button
                  onClick={copy}
                  className="w-full flex items-center justify-between rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 font-mono text-lg tracking-widest text-gray-900 hover:bg-gray-100"
                >
                  link {code}
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-400" />}
                </button>
                <p className="text-xs text-gray-500">Expires in 15 minutes. The code proves both accounts belong to you.</p>
              </>
            ) : (
              <Button onClick={generate} disabled={busy} className="w-full">
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                Connect WhatsApp
              </Button>
            )}
          </>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  )
}

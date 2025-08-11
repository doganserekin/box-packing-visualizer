export function generateId(): string {
  try {
    // Modern secure contexts
    // @ts-ignore - older TS may not know randomUUID
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      // @ts-ignore
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      ;(crypto as any).getRandomValues(bytes)
      // RFC4122 v4
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const toHex = (n: number) => n.toString(16).padStart(2, '0')
      const hex = Array.from(bytes).map(toHex).join('')
      return `${hex.substr(0,8)}-${hex.substr(8,4)}-${hex.substr(12,4)}-${hex.substr(16,4)}-${hex.substr(20)}`
    }
  } catch {}
  // Fallback (not cryptographically strong)
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`
}



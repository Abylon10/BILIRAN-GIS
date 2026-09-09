// lib/deviceId.ts
//
// Generates (or reuses) an anonymous device id stored in localStorage.
// Used only to bind an invitation code to the device that redeems it —
// never used to gate ongoing login.

const KEY = 'bfw_device_id'

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = window.localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    window.localStorage.setItem(KEY, id)
  }
  return id
}
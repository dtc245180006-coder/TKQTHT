// Keep the key after an uncertain response, including across a page reload.
// Store only a digest of the form, never contact details, in sessionStorage.
let current;
const storageKey = "hotel-booking-request";
export async function requestKey(payload) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (!current) {
    try {
      current = JSON.parse(sessionStorage.getItem(storageKey));
    } catch {}
  }
  if (current?.signature !== signature)
    current = { signature, key: crypto.randomUUID() };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(current));
  } catch {}
  return current.key;
}
export function clearRequestKey() {
  current = null;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {}
}

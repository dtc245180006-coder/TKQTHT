// Retain only a form hash and UUID after an uncertain response, including reloads.
export async function durableKey(namespace, payload) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const name = `hotel-${namespace}-${document.body.dataset.userId || "staff"}`;
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(name));
  } catch {}
  if (saved?.signature !== signature)
    saved = { signature, key: crypto.randomUUID() };
  try {
    sessionStorage.setItem(name, JSON.stringify(saved));
  } catch {}
  return saved.key;
}
export function clearDurableKey(namespace) {
  try {
    sessionStorage.removeItem(
      `hotel-${namespace}-${document.body.dataset.userId || "staff"}`,
    );
  } catch {}
}

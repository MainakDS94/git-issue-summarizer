const VAULT_KEY = "gl_pat_vault_v1";

function b64e(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function b64d(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function vaultStorePat(data, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const payload = new TextEncoder().encode(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);

  localStorage.setItem(VAULT_KEY, JSON.stringify({
    salt: b64e(salt),
    iv: b64e(iv),
    ct: b64e(ct)
  }));
}

async function vaultLoadPat(passphrase) {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;

  const { salt, iv, ct } = JSON.parse(raw);
  const key = await deriveKey(passphrase, b64d(salt));

  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64d(iv) },
    key,
    b64d(ct)
  );

  return JSON.parse(new TextDecoder().decode(pt));
}

function vaultClear() {
  localStorage.removeItem(VAULT_KEY);
}

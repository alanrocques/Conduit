/**
 * BYOK settings.
 *
 * The Anthropic API key lives in chrome.storage.session — in-memory only,
 * cleared on browser restart. This trades convenience (re-enter on launch)
 * for not leaving a plaintext key in the extension's profile dir.
 *
 * If we ever add a sync option (chrome.storage.local with explicit consent),
 * gate it behind an options-page checkbox; never quietly upgrade.
 */

const KEY = "conduit:anthropic-api-key";

export async function getApiKey(): Promise<string | null> {
  const store = await chrome.storage.session.get(KEY);
  const v = store[KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function setApiKey(key: string): Promise<void> {
  if (key.length === 0) {
    await chrome.storage.session.remove(KEY);
    return;
  }
  await chrome.storage.session.set({ [KEY]: key });
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}

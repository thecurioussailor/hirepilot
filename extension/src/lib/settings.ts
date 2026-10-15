import { z } from 'zod';

const SettingsSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { serverUrl: 'http://127.0.0.1:8787', token: '' };
const KEY = 'settings';

// chrome.storage.local stays on this machine. The token is for YOUR local
// server only; provider API keys never come near the extension.
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const parsed = SettingsSchema.safeParse(stored[KEY]);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: SettingsSchema.parse(settings) });
}

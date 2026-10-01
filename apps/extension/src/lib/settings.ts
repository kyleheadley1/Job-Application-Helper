export type ExtensionSettings = {
  apiBaseUrl: string;
  token: string;
  webAppUrl: string;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "http://localhost:4000/api",
  token: "",
  webAppUrl: "http://localhost:5173",
};

const SETTINGS_KEY = "settings";
const LAST_CAPTURE_KEY = "lastCaptureId";

const trimSlash = (s: string): string => s.trim().replace(/\/+$/, "");

export const loadSettings = async (): Promise<ExtensionSettings> => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const saved = (stored[SETTINGS_KEY] ?? {}) as Partial<ExtensionSettings>;
  return { ...DEFAULT_SETTINGS, ...saved };
};

export const saveSettings = async (settings: ExtensionSettings): Promise<void> => {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      apiBaseUrl: trimSlash(settings.apiBaseUrl) || DEFAULT_SETTINGS.apiBaseUrl,
      token: settings.token.trim(),
      webAppUrl: trimSlash(settings.webAppUrl) || DEFAULT_SETTINGS.webAppUrl,
    },
  });
};

export const loadLastCaptureId = async (): Promise<string | null> => {
  const stored = await chrome.storage.local.get(LAST_CAPTURE_KEY);
  return (stored[LAST_CAPTURE_KEY] as string | undefined) ?? null;
};

export const saveLastCaptureId = async (id: string): Promise<void> => {
  await chrome.storage.local.set({ [LAST_CAPTURE_KEY]: id });
};

import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ExtensionSettings } from "../lib/settings";

export function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const update = (key: keyof ExtensionSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [key]: e.target.value }));

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettings(settings);
    try {
      await api.listCaptures(1);
      setMessage({ kind: "ok", text: "Saved. Connected to the API." });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : String(error);
      setMessage({ kind: "error", text: `Saved, but the connection check failed: ${text}` });
    }
  };

  return (
    <main className="options">
      <h1>Job Application Helper — Settings</h1>
      <form onSubmit={onSave} className="stack">
        <label className="field">
          <span>API base URL</span>
          <input value={settings.apiBaseUrl} onChange={update("apiBaseUrl")} />
        </label>
        <label className="field">
          <span>Extension token</span>
          <input
            type="password"
            value={settings.token}
            onChange={update("token")}
            placeholder="EXTENSION_API_TOKEN from the root .env"
          />
        </label>
        <label className="field">
          <span>Web app URL</span>
          <input value={settings.webAppUrl} onChange={update("webAppUrl")} />
        </label>
        <button type="submit" className="primary">
          Save and test connection
        </button>
        {message && <p className={message.kind === "ok" ? "ok" : "error"}>{message.text}</p>}
      </form>
    </main>
  );
}

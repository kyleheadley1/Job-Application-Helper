import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type CaptureMethod, type CaptureView } from "../lib/api";
import { extractFromActiveTab, getActiveTab, MIN_JD_CHARS } from "../lib/extractJd";
import {
  DEFAULT_SETTINGS,
  loadLastCaptureId,
  loadSettings,
  saveLastCaptureId,
  type ExtensionSettings,
} from "../lib/settings";
import { CaptureCard } from "./CaptureCard";
import { RecentCaptures } from "./RecentCaptures";

const POLL_MS = 3000;

type PendingSubmit = {
  jdText: string;
  captureMethod: CaptureMethod;
  sourceUrl?: string;
  pageTitle?: string;
};

const errorText = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : String(error);

const isTerminal = (c: CaptureView | null) => !c || c.status === "complete" || c.status === "failed";

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [current, setCurrent] = useState<CaptureView | null>(null);
  const [recent, setRecent] = useState<CaptureView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMethod, setPasteMethod] = useState<CaptureMethod>("paste");
  const lastSubmit = useRef<PendingSubmit | null>(null);

  const refreshRecent = useCallback(async () => {
    try {
      const { items } = await api.listCaptures(8);
      setRecent(items);
    } catch {
      // The status card surfaces connection errors; the recent list just stays stale.
    }
  }, []);

  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.settings) void loadSettings().then(setSettings);
    };
    chrome.storage.onChanged.addListener(onChange);
    void (async () => {
      setSettings(await loadSettings());
      const lastId = await loadLastCaptureId();
      if (lastId) {
        try {
          setCurrent(await api.getCapture(lastId));
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) {
            setNotice({ kind: "error", text: errorText(error) });
          }
        }
      }
      await refreshRecent();
    })();
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refreshRecent]);

  // Poll the backend while the current capture is still being scored.
  useEffect(() => {
    if (!current || isTerminal(current)) return;
    const id = current.id;
    const timer = setInterval(async () => {
      try {
        const next = await api.getCapture(id);
        setCurrent((prev) => (prev?.id === id ? next : prev));
        if (isTerminal(next)) void refreshRecent();
      } catch (error) {
        setNotice({ kind: "error", text: errorText(error) });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [current, refreshRecent]);

  const submit = async (input: PendingSubmit, force = false) => {
    setBusy("Saving…");
    setNotice(null);
    lastSubmit.current = input;
    try {
      const created = await api.createCapture({ ...input, force });
      setCurrent(created);
      await saveLastCaptureId(created.id);
      if (created.deduped) {
        setNotice({ kind: "info", text: "This job was already captured — showing the existing result." });
      }
      setPasteOpen(false);
      setPasteText("");
      void refreshRecent();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const openPasteWith = (text: string, method: CaptureMethod, message: string) => {
    setPasteText(text);
    setPasteMethod(method);
    setPasteOpen(true);
    setNotice({ kind: "info", text: message });
  };

  const onCapture = async () => {
    setBusy("Reading page…");
    setNotice(null);
    try {
      const page = await extractFromActiveTab("auto");
      if (page.method === "none" || page.text.length < MIN_JD_CHARS) {
        openPasteWith(
          page.text,
          "paste",
          "Couldn't find the job description on this page. Highlight it and use Score selected text, or paste it below.",
        );
        return;
      }
      await submit({
        jdText: page.text,
        captureMethod: page.method,
        sourceUrl: page.url,
        pageTitle: page.title,
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const onScoreSelection = async () => {
    setBusy("Reading selection…");
    setNotice(null);
    try {
      const page = await extractFromActiveTab("selection");
      if (page.text.length < MIN_JD_CHARS) {
        setNotice({
          kind: "error",
          text: page.text
            ? `Selection is only ${page.text.length} characters. Highlight the full job description first.`
            : "Highlight the JD first.",
        });
        return;
      }
      await submit({
        jdText: page.text,
        captureMethod: "selection",
        sourceUrl: page.url,
        pageTitle: page.title,
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const onSubmitPaste = async () => {
    const text = pasteText.trim();
    if (text.length < MIN_JD_CHARS) {
      setNotice({ kind: "error", text: `Paste at least ${MIN_JD_CHARS} characters of the job description.` });
      return;
    }
    const tab = await getActiveTab();
    const sourceUrl = tab && /^https?:/i.test(tab.url) ? tab.url : undefined;
    await submit({
      jdText: text,
      captureMethod: pasteMethod,
      sourceUrl,
      pageTitle: sourceUrl ? tab?.title : undefined,
    });
  };

  const onRetry = () => {
    if (lastSubmit.current) void submit(lastSubmit.current, true);
  };

  const onSelectRecent = async (capture: CaptureView) => {
    setCurrent(capture);
    await saveLastCaptureId(capture.id);
  };

  const hasToken = Boolean(settings.token);

  return (
    <main className="panel">
      <header className="panel-header">
        <h1>Job Application Helper</h1>
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </header>

      {!hasToken && (
        <p className="error">
          Add your extension token in{" "}
          <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
            Settings
          </button>{" "}
          to connect to the API.
        </p>
      )}

      <section className="controls">
        <button className="primary" disabled={!hasToken || Boolean(busy)} onClick={onCapture}>
          Capture JD
        </button>
        <button disabled={!hasToken || Boolean(busy)} onClick={onScoreSelection}>
          Score selected text
        </button>
        <button
          disabled={!hasToken || Boolean(busy)}
          onClick={() => {
            setPasteMethod("paste");
            setPasteOpen((open) => !open);
          }}
        >
          {pasteOpen ? "Hide paste box" : "Paste JD"}
        </button>
      </section>

      {pasteOpen && (
        <section className="stack">
          <textarea
            rows={10}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste the full job description here"
          />
          <div className="row">
            <span className="muted">{pasteText.trim().length} chars</span>
            <button className="primary" disabled={Boolean(busy)} onClick={onSubmitPaste}>
              Score
            </button>
          </div>
        </section>
      )}

      {busy && <p className="muted">{busy}</p>}
      {notice && <p className={notice.kind === "error" ? "error" : "info"}>{notice.text}</p>}

      {current && (
        <CaptureCard
          capture={current}
          webAppUrl={settings.webAppUrl}
          onRetry={lastSubmit.current ? onRetry : undefined}
          onRescore={
            current.deduped && lastSubmit.current
              ? () => void submit(lastSubmit.current!, true)
              : undefined
          }
        />
      )}

      <RecentCaptures items={recent} currentId={current?.id} onSelect={onSelectRecent} />
    </main>
  );
}

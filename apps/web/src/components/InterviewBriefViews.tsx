import { useEffect, useState, type KeyboardEvent } from "react";
import type { InterviewBrief, InterviewBriefResponse } from "../types/gmail";

/** Design alternatives for the interview prep brief, switchable in the panel for side-by-side review. */
export const BRIEF_STYLES = [
  { id: "sections", label: "Sections" },
  { id: "minimal", label: "Minimal" },
  { id: "tabs", label: "Tabs" },
  { id: "rehearse", label: "Rehearse" },
  { id: "atmos", label: "Atmospheric" },
] as const;
export type BriefStyle = (typeof BRIEF_STYLES)[number]["id"];

const STORAGE_KEY = "briefStyle";

export const useBriefStyle = (): [BriefStyle, (s: BriefStyle) => void] => {
  const [style, setStyle] = useState<BriefStyle>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return BRIEF_STYLES.some((s) => s.id === saved) ? (saved as BriefStyle) : "sections";
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, style);
  }, [style]);
  return [style, setStyle];
};

export function BriefStylePicker({ value, onChange }: { value: BriefStyle; onChange: (s: BriefStyle) => void }) {
  return (
    <div className="bv-picker" role="radiogroup" aria-label="Brief layout">
      {BRIEF_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          className={value === s.id ? "active" : ""}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

type ViewProps = { data: InterviewBriefResponse; b: InterviewBrief };

/** Linear/Stripe-style: no boxes, type does the hierarchy, color only as small status dots. */
export function MinimalBrief({ data, b }: ViewProps) {
  return (
    <div className="bv-min">
      <header className="bv-min-head">
        <span className="bv-min-company">{data.company}</span>
        <span className="muted">
          {[data.role, data.round].filter(Boolean).join(" · ")}
        </span>
      </header>
      <p className="bv-min-lede">{b.companyBio}</p>
      <p className="bv-min-need">
        <span className="bv-kicker">Team need</span>
        {b.teamNeed}
      </p>
      <div className="bv-min-grid">
        <div>
          <h5 className="bv-min-h">
            <i className="bv-dot bv-good" /> Why you fit
          </h5>
          {b.strengths.map((s) => (
            <div key={s.point} className="bv-min-item">
              <div className="bv-min-title">{s.point}</div>
              <div className="muted">{s.evidence}</div>
            </div>
          ))}
        </div>
        <div>
          <h5 className="bv-min-h">
            <i className="bv-dot bv-warn" /> Weak spots
          </h5>
          {b.weakPoints.map((w) => (
            <div key={w.gap} className="bv-min-item">
              <div className="bv-min-title">{w.gap}</div>
              <div className="bv-min-q">
                <span className="bv-kicker">Q</span>
                {w.probe}
              </div>
              <div className="bv-min-a">
                <span className="bv-kicker">A</span>
                {w.answer}
              </div>
            </div>
          ))}
        </div>
      </div>
      {b.askThem.length > 0 && (
        <>
          <h5 className="bv-min-h">
            <i className="bv-dot bv-info" /> Ask them
          </h5>
          {b.askThem.map((q) => (
            <div key={q} className="bv-min-ask">
              <span aria-hidden>→</span> {q}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const TABS = ["overview", "fit", "gaps", "ask"] as const;
type Tab = (typeof TABS)[number];

/** Progressive disclosure: one topic at a time keeps the table row short. Arrow keys switch tabs. */
export function TabsBrief({ data, b }: ViewProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const label: Record<Tab, string> = {
    overview: "Overview",
    fit: `Why you fit · ${b.strengths.length}`,
    gaps: `Weak spots · ${b.weakPoints.length}`,
    ask: `Ask them · ${b.askThem.length}`,
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    if (e.key === "ArrowRight") setTab(TABS[(i + 1) % TABS.length]!);
    if (e.key === "ArrowLeft") setTab(TABS[(i + TABS.length - 1) % TABS.length]!);
  };
  return (
    <div className="bv-tabs">
      <div className="bv-tablist" role="tablist" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            className={`bv-tab bv-tab-${t}${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {label[t]}
          </button>
        ))}
      </div>
      <div className="bv-tabpanel" role="tabpanel" key={tab}>
        {tab === "overview" && (
          <>
            <p className="bv-min-lede">{b.companyBio}</p>
            <p className="bv-min-need">
              <span className="bv-kicker">Team need</span>
              {b.teamNeed}
            </p>
            <div className="bv-chips">
              <button type="button" className="bv-chip bv-good" onClick={() => setTab("fit")}>
                {b.strengths.length} strengths
              </button>
              <button type="button" className="bv-chip bv-warn" onClick={() => setTab("gaps")}>
                {b.weakPoints.length} gaps to prep
              </button>
              <button type="button" className="bv-chip bv-info" onClick={() => setTab("ask")}>
                {b.askThem.length} questions
              </button>
              {data.round && <span className="muted smallText">{data.round}</span>}
            </div>
          </>
        )}
        {tab === "fit" &&
          b.strengths.map((s) => (
            <div key={s.point} className="bv-min-item">
              <div className="bv-min-title">{s.point}</div>
              <div className="muted">{s.evidence}</div>
            </div>
          ))}
        {tab === "gaps" &&
          b.weakPoints.map((w) => (
            <div key={w.gap} className="bv-min-item">
              <div className="bv-min-title">{w.gap}</div>
              <div className="bv-min-q">
                <span className="bv-kicker">They may ask</span>
                <em>{w.probe}</em>
              </div>
              <div className="briefSay">
                <span className="briefLabel">You can say</span> {w.answer}
              </div>
            </div>
          ))}
        {tab === "ask" && (
          <ol className="bv-ask-list">
            {b.askThem.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

type Card = { kind: "gap" | "fit"; topic: string; prompt: string; answer: string };
type Mark = "solid" | "again";

const deckOf = (b: InterviewBrief): Card[] => [
  ...b.weakPoints.map((w) => ({ kind: "gap" as const, topic: w.gap, prompt: w.probe, answer: w.answer })),
  ...b.strengths.map((s) => ({
    kind: "fit" as const,
    topic: s.point,
    prompt: `Walk me through your experience: ${s.point.toLowerCase()}.`,
    answer: s.evidence,
  })),
];

/** Active recall: answer out loud first, then flip. Space flips, 1 = practice again, 2 = got it. */
export function RehearseBrief({ data, b }: ViewProps) {
  const deck = deckOf(b);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<number, Mark>>({});
  const done = i >= deck.length;
  const card = deck[i];

  const mark = (m: Mark) => {
    setMarks((prev) => ({ ...prev, [i]: m }));
    setFlipped(false);
    setI((n) => n + 1);
  };
  const restart = (onlyAgain: boolean) => {
    const first = onlyAgain ? deck.findIndex((_, n) => marks[n] === "again") : 0;
    setMarks(onlyAgain ? Object.fromEntries(Object.entries(marks).filter(([, m]) => m === "solid")) : {});
    setI(Math.max(0, first));
    setFlipped(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (done) return;
    if (e.key === " ") {
      e.preventDefault();
      setFlipped((f) => !f);
    } else if (flipped && e.key === "1") mark("again");
    else if (flipped && e.key === "2") mark("solid");
  };
  const solid = Object.values(marks).filter((m) => m === "solid").length;

  return (
    <div className="bv-rehearse" tabIndex={0} onKeyDown={onKey}>
      <p className="bv-rehearse-context muted">
        <strong>{data.company}</strong> · {b.teamNeed}
      </p>
      <div className="bv-progress" aria-label={`Card ${Math.min(i + 1, deck.length)} of ${deck.length}`}>
        {deck.map((c, n) => (
          <span
            key={n}
            className={`bv-seg ${c.kind} ${marks[n] ?? ""} ${n === i ? "current" : ""}`}
            title={c.topic}
          />
        ))}
      </div>
      {done ? (
        <div className="bv-done">
          <div className="bv-done-score">
            {solid}/{deck.length} solid
          </div>
          <div className="row" style={{ gap: "0.5rem", justifyContent: "center" }}>
            {solid < deck.length && (
              <button type="button" onClick={() => restart(true)}>
                Practice the {deck.length - solid} again
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => restart(false)}>
              Start over
            </button>
          </div>
          {b.askThem.length > 0 && (
            <div className="bv-done-ask">
              <span className="bv-kicker">Close with</span>
              {b.askThem.map((q) => (
                <div key={q}>“{q}”</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        card && (
          <>
            <button
              type="button"
              className={`bv-card ${card.kind}${flipped ? " flipped" : ""}`}
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show question" : "Show answer"}
            >
              <span className="bv-card-inner">
                <span className="bv-face bv-front">
                  <span className="bv-kicker">{card.kind === "gap" ? "Weak spot" : "Strength"} · {card.topic}</span>
                  <span className="bv-card-q">{card.prompt}</span>
                  <span className="muted smallText">Answer out loud, then click or press Space</span>
                </span>
                <span className="bv-face bv-back">
                  <span className="bv-kicker">{card.kind === "gap" ? "A bridge answer" : "Your proof"}</span>
                  <span className="bv-card-a">{card.answer}</span>
                </span>
              </span>
            </button>
            <div className="row bv-rate" style={{ gap: "0.5rem" }}>
              {flipped ? (
                <>
                  <button type="button" className="btn-secondary" onClick={() => mark("again")}>
                    Practice again <kbd>1</kbd>
                  </button>
                  <button type="button" onClick={() => mark("solid")}>
                    Got it <kbd>2</kbd>
                  </button>
                </>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setFlipped(true)}>
                  Show answer <kbd>Space</kbd>
                </button>
              )}
              <span className="muted smallText">
                {i + 1} of {deck.length}
              </span>
            </div>
          </>
        )
      )}
    </div>
  );
}

/** Railway-style: one soft atmospheric gradient behind a serif headline; content stays flat. */
export function AtmosBrief({ data, b }: ViewProps) {
  return (
    <div className="bv-atmos">
      <header className="bv-atmos-hero">
        <span className="bv-kicker">{data.round ?? "Interview"}</span>
        <h3 className="bv-atmos-title">{data.company}</h3>
        <p className="bv-atmos-bio">{b.companyBio}</p>
        <p className="bv-atmos-need">
          They need someone to <em>{b.teamNeed.charAt(0).toLowerCase() + b.teamNeed.slice(1)}</em>
        </p>
      </header>
      <div className="bv-atmos-grid">
        <section className="bv-atmos-col bv-good">
          <h5>Lead with</h5>
          {b.strengths.map((s, n) => (
            <div key={s.point} className="bv-atmos-item" style={{ animationDelay: `${n * 60}ms` }}>
              <div className="bv-min-title">{s.point}</div>
              <div className="muted">{s.evidence}</div>
            </div>
          ))}
        </section>
        <section className="bv-atmos-col bv-warn">
          <h5>Be ready for</h5>
          {b.weakPoints.map((w, n) => (
            <div key={w.gap} className="bv-atmos-item" style={{ animationDelay: `${(n + 3) * 60}ms` }}>
              <div className="bv-min-title">{w.probe}</div>
              <blockquote className="bv-atmos-quote">{w.answer}</blockquote>
            </div>
          ))}
        </section>
      </div>
      {b.askThem.length > 0 && (
        <footer className="bv-atmos-ask">
          <h5>Ask them</h5>
          {b.askThem.map((q) => (
            <p key={q}>{q}</p>
          ))}
        </footer>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ScoringDetail, ScoringReport } from "../types/gmail";
import { JsonPanel } from "./JsonPanel";

const CATEGORY_MAX: Record<string, number> = {
  stackFit: 20,
  levelFit: 20,
  functionalOverlap: 15,
  recruiterFriendliness: 15,
  domainFit: 10,
  resumeStoryClarity: 10,
  careerValue: 10,
};

/** Rule flags that help the candidate or only describe context; everything else limits the score. */
const FAVORABLE_FLAGS = new Set([
  "earlyCareerFriendlyRole",
  "pythonStackFlexibleWithJsTs",
  "healthcareProductEngineering",
  "backendProductApiRole",
  "degreeHasEquivalencyClause",
  "degreeEquivalencySatisfied",
  "jdDegreePositive",
  "disjunctiveLanguageRequirementSatisfied",
  "matureStructuredEmployer",
]);

/** Shown in their own sections below. */
const SECTIONED_RULE_KEYS = new Set(["notes", "hardRuleNotes", "hardRuleFlags", "penaltyVector"]);

const humanize = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

const fmt = (n: number | undefined, digits = 0) => (typeof n === "number" ? n.toFixed(digits) : "—");

type FiredRule = { key: string; value: string; favorable: boolean };

/** Every rule output that is set: true flags, non-empty lists, objects, and strings. */
const firedRules = (rules: Record<string, unknown>): FiredRule[] => {
  const out: FiredRule[] = [];
  for (const [key, value] of Object.entries(rules)) {
    if (SECTIONED_RULE_KEYS.has(key) || key === "newGradPenalty") continue;
    const favorable = FAVORABLE_FLAGS.has(key);
    if (value === true) out.push({ key, value: "yes", favorable });
    else if (Array.isArray(value) && value.length > 0) out.push({ key, value: value.join(", "), favorable });
    else if (typeof value === "string" && value) out.push({ key, value, favorable });
    else if (typeof value === "number" && value) out.push({ key, value: String(value), favorable });
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const { reason, evidence, dock } = value as { reason?: unknown; evidence?: unknown; dock?: unknown };
      const text = typeof reason === "string" ? reason : typeof evidence === "string" ? evidence : null;
      out.push({
        key,
        value: text ? `${typeof dock === "number" ? `−${dock}: ` : ""}${text}` : JSON.stringify(value),
        favorable,
      });
    }
  }
  return out.sort((a, b) => Number(a.favorable) - Number(b.favorable));
};

function DetailView({ detail }: { detail: ScoringDetail }) {
  const { score, rules, extracted } = detail;
  const display = score.scoreDisplay;
  const fired = firedRules(rules);
  const penalties = Object.entries((rules.penaltyVector as Record<string, number> | undefined) ?? {}).filter(
    ([, v]) => v,
  );
  const scoreNotes = [
    display?.roleFunctionCapNote ?? score.roleFunctionCapNote,
    display?.differentiatorCoverageNote ?? score.differentiatorCoverageNote,
    display?.poolFriendlinessNote,
    display?.credentialBoostNote,
    display?.degreePositiveNote ?? score.degreePositiveNote,
    display?.contractCaveat ?? score.contractCaveat,
    display?.genAiRestrictionWarning,
  ].filter((n): n is string => typeof n === "string" && n.length > 0);

  return (
    <div className="stack" style={{ gap: "0.9rem" }}>
      <div className="row" style={{ gap: "1.5rem", flexWrap: "wrap" }}>
        <div>
          <div className="muted smallText">Final</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{fmt(score.total)}</div>
        </div>
        <div>
          <div className="muted smallText">Capability</div>
          <div style={{ fontSize: "1.2rem" }}>{fmt(score.capability)}</div>
        </div>
        <div>
          <div className="muted smallText">Survivability</div>
          <div style={{ fontSize: "1.2rem" }}>{fmt(score.survivability, 3)}</div>
        </div>
        <div>
          <div className="muted smallText">Survivability adj.</div>
          <div style={{ fontSize: "1.2rem" }}>{fmt(display?.survAdjustment, 1)}</div>
        </div>
        <div>
          <div className="muted smallText">Gap dock</div>
          <div style={{ fontSize: "1.2rem" }}>{fmt(display?.gapDock, 1)}</div>
        </div>
        <div>
          <div className="muted smallText">Recommendation</div>
          <div style={{ fontSize: "1.2rem" }}>{display?.bandHeadline ?? detail.recommendation ?? "—"}</div>
        </div>
      </div>

      {display?.scoreDerivation && (
        <div>
          <strong className="smallText">How the final was computed</strong>
          <pre className="jsonPanel" style={{ whiteSpace: "pre-wrap" }}>{display.scoreDerivation}</pre>
        </div>
      )}

      {(score.historyAdjustments?.length ?? 0) > 0 && (
        <div>
          <strong className="smallText">Your history</strong>
          <ul className="smallText">
            {score.historyAdjustments!.map((a) => (
              <li key={a.id}>
                {a.label}: {a.points > 0 ? "+" : ""}
                {a.points}
              </li>
            ))}
          </ul>
          <span className="muted smallText">
            From scoring adjustments you approved in Application insights (capped at ±8 total, included in the final).
          </span>
        </div>
      )}

      {(display?.hardGates?.length ?? 0) > 0 && (
        <div>
          <strong className="smallText">Hard gates</strong>
          <ul>{display!.hardGates.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
        <div>
          <strong className="smallText">LLM category scores</strong>
          <table className="table">
            <tbody>
              {Object.keys(CATEGORY_MAX).map((k) => (
                <tr key={k}>
                  <td>{humanize(k)}</td>
                  <td>
                    {fmt(score[k as keyof typeof score] as number | undefined)} / {CATEGORY_MAX[k]}
                  </td>
                  <td className="muted smallText">
                    {score.capabilityBreakdown && k in score.capabilityBreakdown
                      ? `capability input ${fmt(score.capabilityBreakdown[k as keyof typeof score.capabilityBreakdown])}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <strong className="smallText">Survivability rows</strong>
          {display?.survivabilityRows?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Score</th>
                  <th>Weight</th>
                  <th>Contrib.</th>
                </tr>
              </thead>
              <tbody>
                {display.survivabilityRows.map((r) => (
                  <tr key={r.key} title={`${r.penaltyName} · ${r.bindingness} · lever: ${r.leverLabel}`}>
                    <td>{r.label}</td>
                    <td>{fmt(r.score, 2)}</td>
                    <td>{fmt(r.weight, 2)}</td>
                    <td>{fmt(r.contribution, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <JsonPanel value={score.survivabilityBreakdown ?? {}} />
          )}
        </div>
      </div>

      <div>
        <strong className="smallText">Rules that fired ({fired.length})</strong>
        {fired.length === 0 ? (
          <p className="muted smallText">No rule flags set.</p>
        ) : (
          <table className="table">
            <tbody>
              {fired.map((r) => (
                <tr key={r.key}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className={`pill ${r.favorable ? "good" : "warn"}`}>{r.favorable ? "context" : "limits"}</span>
                  </td>
                  <td>
                    <code>{r.key}</code>
                    <div className="muted smallText">{humanize(r.key)}</div>
                  </td>
                  <td className="smallText" style={{ wordBreak: "break-word" }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {penalties.length > 0 && (
        <div>
          <strong className="smallText">Penalty vector</strong>
          <ul className="smallText">
            {penalties.map(([k, v]) => (
              <li key={k}>
                <code>{k}</code>: {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      {((rules.hardRuleFlags?.length ?? 0) > 0 || (rules.hardRuleNotes?.length ?? 0) > 0) && (
        <div>
          <strong className="smallText">Hard-rule flags and notes</strong>
          <ul className="smallText">
            {rules.hardRuleFlags?.map((f) => (
              <li key={f.id}>
                <code>{f.id}</code>: {f.message}
              </li>
            ))}
            {rules.hardRuleNotes?.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}

      {(display?.survivabilityPenalties?.length ?? 0) > 0 && (
        <div>
          <strong className="smallText">Survivability penalties</strong>
          <ul className="smallText">
            {display!.survivabilityPenalties.map((p) => (
              <li key={p.message}>
                {p.message} <span className="muted">({p.leverLabel})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(rules.notes.length > 0 || scoreNotes.length > 0) && (
        <div>
          <strong className="smallText">Rule and score notes</strong>
          <ul className="smallText">
            {[...rules.notes, ...scoreNotes].map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}
          </ul>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
        <div>
          <strong className="smallText">Rationale</strong>
          <ul className="smallText">
            <li>
              <strong>Top match:</strong> {detail.topMatch}
            </li>
            <li>
              <strong>Main risk:</strong> {detail.mainRisk}
            </li>
            {detail.rationale.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
        <div>
          <strong className="smallText">Risks</strong>
          <ul className="smallText">{detail.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          <strong className="smallText">Resume pick: {detail.recommendedResume}</strong>
          <ul className="smallText">{detail.resumeRationale.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </div>

      <details>
        <summary className="smallText">What the extractor read from the JD</summary>
        <div className="smallText stack" style={{ gap: "0.3rem" }}>
          <div>
            <strong>{extracted.title}</strong> · {extracted.seniority ?? "seniority ?"} · {extracted.location ?? "location ?"} ·{" "}
            {extracted.remoteType ?? "?"}
          </div>
          <div>
            <strong>Required:</strong> {extracted.requiredSkills.join(", ") || "—"}
          </div>
          <div>
            <strong>Preferred:</strong> {extracted.preferredSkills.join(", ") || "—"}
          </div>
          <div>
            <strong>Stack:</strong> {extracted.stack.join(", ") || "—"}
          </div>
          <div>
            <strong>Domain:</strong> {extracted.domainTags.join(", ") || "—"}
          </div>
          {extracted.requirements.length > 0 && (
            <div>
              <strong>Requirements:</strong>
              <ul>{extracted.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          <JsonPanel value={extracted} />
        </div>
      </details>

      <details>
        <summary className="smallText">Raw scorer output (score + rules)</summary>
        <JsonPanel value={{ score, rules }} />
      </details>
    </div>
  );
}

type Source = "original" | "diagnostic";

export function ScoringDetailsPanel({ appKey }: { appKey: string }) {
  const [report, setReport] = useState<ScoringReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<Source>("original");

  useEffect(() => {
    let cancelled = false;
    api
      .gmailScoringReport(appKey)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setSource(r.fit?.detail ? "original" : "diagnostic");
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [appKey]);

  const runDiagnostic = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.gmailRunDiagnostic(appKey);
      setReport(r);
      setSource("diagnostic");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (error && !report) return <p className="error">{error}</p>;
  if (!report) return <p className="muted">Loading scoring details…</p>;

  const detail = source === "original" ? report.fit?.detail : report.diagnostic?.detail;

  return (
    <div className="stack" style={{ gap: "0.75rem" }}>
      <div className="rowBetween" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <div className="smallText">
          <strong>
            {report.company}
            {report.role ? ` — ${report.role}` : ""}
          </strong>
          {report.fit && (
            <span className="muted">
              {" "}
              · scored {Math.round(report.fit.total)} on {new Date(report.fit.scoredAt).toLocaleDateString()} (
              {report.fit.promptVersion})
            </span>
          )}
          {report.diagnostic && (
            <span className="muted">
              {" "}
              · diagnostic re-run {Math.round(report.diagnostic.total)} on{" "}
              {new Date(report.diagnostic.runAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          {report.fit?.detail && report.diagnostic && (
            <>
              <button
                className={`chip${source === "original" ? " active" : ""}`}
                onClick={() => setSource("original")}
              >
                Original
              </button>
              <button
                className={`chip${source === "diagnostic" ? " active" : ""}`}
                onClick={() => setSource("diagnostic")}
              >
                Diagnostic
              </button>
            </>
          )}
          {report.jd && (
            <button
              className="btn-secondary"
              onClick={() => void runDiagnostic()}
              disabled={running}
              title="Scores the stored JD again (about 1¢). The fit score shown on the dashboard does not change."
            >
              {running ? "Re-scoring…" : report.diagnostic ? "Re-run diagnostic" : "Run diagnostic re-score"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {detail ? (
        <DetailView detail={detail} />
      ) : (
        <p className="muted smallText">
          This role was scored before full scoring details were saved, so only the summary exists. Run a diagnostic
          re-score to see every category, rule, and penalty for the stored JD. The re-run can differ by a few points
          because the LLM categories aren&apos;t deterministic, but the rules that fire should be the same.
        </p>
      )}

      {report.jd && (
        <details>
          <summary className="smallText">
            Stored JD ({report.jd.text.length.toLocaleString()} chars)
            {report.jd.url && (
              <>
                {" · "}
                <a href={report.jd.url} target="_blank" rel="noreferrer">
                  posting
                </a>
              </>
            )}
          </summary>
          <pre className="jsonPanel" style={{ whiteSpace: "pre-wrap", maxHeight: "24rem", overflow: "auto" }}>
            {report.jd.text}
          </pre>
        </details>
      )}
    </div>
  );
}

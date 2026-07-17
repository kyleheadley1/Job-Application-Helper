import { describe, expect, it } from "vitest";
import {
  citeProductionRigorSpan,
  firstJdMatch,
  trimCiteSpan,
} from "../../lib/jdGroundedRiskNotes.js";

describe("trimCiteSpan", () => {
  it("does not truncate mid-word at a fixed character budget", () => {
    const raw =
      "payments platform build new features to improve product experience for cardholders";
    const out = trimCiteSpan(raw, 58);
    expect(out.toLowerCase()).not.toMatch(/\bex$/);
    expect(out).not.toMatch(/\s\w{1,2}$/); // no dangling 1–2 letter stub
    expect(out.split(/\s+/).every((w) => w.length >= 1)).toBe(true);
  });

  it("strips trailing dangling connectors after a clause cut", () => {
    expect(trimCiteSpan("incident response and debug production issues to", 72)).toBe(
      "incident response and debug production issues",
    );
    expect(trimCiteSpan("reliability expectations for the", 72)).toBe("reliability expectations");
  });
});

describe("firstJdMatch / production rigor cites", () => {
  it("prefers a phrase match over open-ended trailing capture", () => {
    const text =
      "Own incident response and debug production issues to keep SLOs healthy under load.";
    expect(citeProductionRigorSpan(text).toLowerCase()).toBe("incident response");
  });

  it("keeps payment platform cites as a short noun phrase", () => {
    const text =
      "Build payments platform build new features to improve product experience for merchants.";
    const cite = firstJdMatch(text, [
      /\b(payment(?:s)?\s+(?:platform|infrastructure|processing|flows?|systems?|apis?|product))\b/i,
      /\bpayments?\b/i,
    ]);
    expect(cite?.toLowerCase()).toBe("payments platform");
  });
});

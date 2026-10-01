import type { CaptureMethod } from "./api";

export const MIN_JD_CHARS = 200;

export type PageExtraction = {
  text: string;
  method: CaptureMethod | "none";
  url: string;
  title: string;
};

/**
 * Injected into the page with chrome.scripting.executeScript.
 * Must stay self-contained: it is serialized, so it cannot reference imports or module scope.
 */
export function extractJdFromPage(mode: "auto" | "selection", minChars: number): PageExtraction {
  const clean = (s: string): string =>
    s
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  const base = { url: location.href, title: document.title };
  const selection = clean(window.getSelection()?.toString() ?? "");

  if (mode === "selection") {
    return { ...base, text: selection, method: selection ? "selection" : "none" };
  }
  if (selection.length >= minChars) {
    return { ...base, text: selection, method: "selection" };
  }

  const htmlToText = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    doc.querySelectorAll("p, li, div, h1, h2, h3, h4, h5, h6, tr").forEach((el) => {
      el.append("\n");
    });
    doc.querySelectorAll("li").forEach((li) => li.prepend("- "));
    return clean(doc.body.textContent ?? "");
  };

  // Structured JobPosting data (schema.org), common on Greenhouse, Lever, Ashby, Workday, etc.
  const postings: Array<Record<string, unknown>> = [];
  const collect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && /JobPosting/i.test(t))) postings.push(obj);
    if (obj["@graph"]) collect(obj["@graph"]);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      collect(JSON.parse(script.textContent ?? ""));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });
  for (const posting of postings) {
    const description = typeof posting.description === "string" ? htmlToText(posting.description) : "";
    if (description.length < minChars) continue;
    const org = posting.hiringOrganization as Record<string, unknown> | undefined;
    const company = typeof org?.name === "string" ? org.name : "";
    const jobTitle = typeof posting.title === "string" ? posting.title : "";
    const locations = ([] as unknown[]).concat(posting.jobLocation ?? []);
    const locationText = locations
      .map((loc) => {
        const address = (loc as Record<string, unknown>)?.address as Record<string, unknown> | undefined;
        return [address?.addressLocality, address?.addressRegion, address?.addressCountry]
          .filter((part) => typeof part === "string" && part)
          .join(", ");
      })
      .filter(Boolean)
      .join("; ");
    const remote = posting.jobLocationType === "TELECOMMUTE" ? "Remote" : "";
    const header = [
      jobTitle && `Title: ${jobTitle}`,
      company && `Company: ${company}`,
      (locationText || remote) && `Location: ${[locationText, remote].filter(Boolean).join(" / ")}`,
    ]
      .filter(Boolean)
      .join("\n");
    return { ...base, text: clean(`${header}\n\n${description}`), method: "jsonld" };
  }

  // Known JD containers for common boards, then generic description containers.
  const selectors = [
    '[data-automation-id="jobPostingDescription"]', // Workday
    "#jobDescriptionText", // Indeed
    ".jobs-description__content", // LinkedIn
    "#job-details",
    ".show-more-less-html__markup",
    ".job__description", // Greenhouse (new boards)
    "#content .body", // Greenhouse (classic)
    "#app_body",
    '[data-qa="job-description"]', // Lever
    ".posting-page .content",
    '[class*="descriptionText"]', // Ashby
    ".ashby-job-posting-right-pane",
    '[class*="job-description" i]',
    '[id*="job-description" i]',
    '[class*="jobDescription"]',
    '[id*="jobDescription"]',
    '[class*="job-details" i]',
    '[class*="posting" i] [class*="description" i]',
    "article",
    "main",
  ];
  let best = "";
  for (const selector of selectors) {
    let elements: Element[] = [];
    try {
      elements = Array.from(document.querySelectorAll(selector));
    } catch {
      continue;
    }
    for (const el of elements) {
      const text = clean((el as HTMLElement).innerText ?? "");
      // Prefer the first specific selector that yields a real JD; generic ones only as fallback.
      if (text.length >= minChars && text.length <= 60_000) {
        if (selector === "article" || selector === "main") {
          if (text.length > best.length) best = text;
        } else {
          return { ...base, text, method: "container" };
        }
      }
    }
  }
  if (best) return { ...base, text: best, method: "container" };

  return { ...base, text: selection, method: "none" };
}

export type ActiveTabInfo = { id: number; url: string; title: string };

export const getActiveTab = async (): Promise<ActiveTabInfo | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" };
};

const isPermissionError = (error: unknown): boolean =>
  /cannot access|permission|host/i.test(error instanceof Error ? error.message : String(error));

const runInFrames = async (
  tabId: number,
  mode: "auto" | "selection",
): Promise<PageExtraction[]> => {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: extractJdFromPage,
    args: [mode, MIN_JD_CHARS],
  });
  return results
    .map((r) => r.result as PageExtraction | undefined)
    .filter((r): r is PageExtraction => Boolean(r));
};

/**
 * Read the JD from the active tab (all accessible frames — boards are often embedded in iframes).
 * If Chrome hasn't granted access to this site yet, ask for it once and retry.
 */
export const extractFromActiveTab = async (
  mode: "auto" | "selection",
): Promise<PageExtraction> => {
  const tab = await getActiveTab();
  if (!tab) throw new Error("No active tab found.");
  if (!/^https?:/i.test(tab.url)) {
    throw new Error("Open a job posting page (http/https) first.");
  }

  let frames: PageExtraction[];
  try {
    frames = await runInFrames(tab.id, mode);
  } catch (error) {
    if (!isPermissionError(error)) throw error;
    const origin = new URL(tab.url).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error("Chrome didn't grant access to this page. Use Paste JD instead.");
    frames = await runInFrames(tab.id, mode);
  }

  const rank: Record<PageExtraction["method"], number> = {
    selection: 4,
    jsonld: 3,
    container: 2,
    paste: 1,
    none: 0,
  };
  const best = frames.sort(
    (a, b) => rank[b.method] - rank[a.method] || b.text.length - a.text.length,
  )[0];
  // Always report the top-level page as the source, even if the JD came from an iframe.
  return {
    text: best?.text ?? "",
    method: best?.method ?? "none",
    url: tab.url,
    title: tab.title,
  };
};

import { getDb } from "../../../config/mongo.js";
import { normalizeCompany } from "../gmailApplications.js";
import type { AtsKind, BoardRef } from "./atsHints.js";
import { fetchPosting, htmlToText, PostingFetchError, validatePosting, type FetchedPosting } from "./fetchPosting.js";

export type BoardJob = {
  id: string;
  title: string;
  url: string;
  requisitionId?: string;
  location?: string;
  /** Full JD text when the list endpoint includes it. */
  text?: string;
};

export type BoardListing = { ref: BoardRef; companyName?: string; jobs: BoardJob[] };

const FETCH_TIMEOUT_MS = 15_000;
const UA = "Mozilla/5.0 (compatible; JobApplicationHelper/1.0)";
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GUESSABLE_ATS: AtsKind[] = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable"];
const MIN_EXACT_SLUG_CHARS = 6;

/** Returns null on 404 so callers can tell "no such board" from a network error. */
const request = async <T>(url: string, init?: RequestInit): Promise<T | null> => {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "User-Agent": UA, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new PostingFetchError("http_error", `HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
};

const enc = encodeURIComponent;

type GreenhouseList = {
  jobs?: Array<{
    id: number;
    title: string;
    absolute_url: string;
    content?: string;
    requisition_id?: string | null;
    location?: { name?: string };
  }>;
};

const listGreenhouse = async (ref: BoardRef): Promise<BoardListing | null> => {
  const base = `https://boards-api.greenhouse.io/v1/boards/${enc(ref.slug)}`;
  const [list, board] = await Promise.all([
    request<GreenhouseList>(`${base}/jobs?content=true`),
    request<{ name?: string }>(base).catch(() => null),
  ]);
  if (!list) return null;
  return {
    ref,
    companyName: board?.name,
    jobs: (list.jobs ?? []).map((j) => ({
      id: String(j.id),
      title: j.title,
      url: j.absolute_url,
      requisitionId: j.requisition_id ?? undefined,
      location: j.location?.name,
      text: j.content ? [j.title, htmlToText(j.content)].join("\n\n") : undefined,
    })),
  };
};

type LeverItem = {
  id: string;
  text: string;
  hostedUrl: string;
  descriptionPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
  additionalPlain?: string;
  categories?: { location?: string };
};

const listLever = async (ref: BoardRef): Promise<BoardListing | null> => {
  const items = await request<LeverItem[] | { ok: false }>(`https://api.lever.co/v0/postings/${enc(ref.slug)}?mode=json`);
  if (!items || !Array.isArray(items)) return null;
  return {
    ref,
    jobs: items.map((p) => ({
      id: p.id,
      title: p.text,
      url: p.hostedUrl,
      location: p.categories?.location,
      text: [
        p.text,
        p.descriptionPlain,
        ...(p.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`),
        p.additionalPlain,
      ]
        .filter(Boolean)
        .join("\n\n"),
    })),
  };
};

type AshbyList = {
  jobs?: Array<{
    id: string;
    title: string;
    jobUrl?: string;
    location?: string;
    descriptionPlain?: string;
    descriptionHtml?: string;
  }>;
};

const listAshby = async (ref: BoardRef): Promise<BoardListing | null> => {
  const board = await request<AshbyList>(`https://api.ashbyhq.com/posting-api/job-board/${enc(ref.slug)}`);
  if (!board) return null;
  return {
    ref,
    jobs: (board.jobs ?? []).map((j) => ({
      id: j.id,
      title: j.title,
      url: j.jobUrl ?? `https://jobs.ashbyhq.com/${ref.slug}/${j.id}`,
      location: j.location,
      text: [j.title, j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? "")].filter(Boolean).join("\n\n"),
    })),
  };
};

type SmartRecruitersList = {
  totalFound?: number;
  content?: Array<{
    id: string;
    name: string;
    refNumber?: string;
    company?: { name?: string };
    location?: { city?: string; region?: string };
  }>;
};

const listSmartRecruiters = async (ref: BoardRef, query?: string): Promise<BoardListing | null> => {
  const q = query ? `&q=${enc(query)}` : "";
  const list = await request<SmartRecruitersList>(
    `https://api.smartrecruiters.com/v1/companies/${enc(ref.slug)}/postings?limit=100${q}`,
  );
  if (!list || !list.content?.length) return null;
  return {
    ref,
    companyName: list.content[0]?.company?.name,
    jobs: list.content.map((j) => ({
      id: j.id,
      title: j.name,
      url: `https://jobs.smartrecruiters.com/${ref.slug}/${j.id}`,
      requisitionId: j.refNumber,
      location: [j.location?.city, j.location?.region].filter(Boolean).join(", ") || undefined,
    })),
  };
};

type SmartRecruitersDetail = {
  name?: string;
  refNumber?: string;
  company?: { name?: string };
  releasedDate?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
};

const smartRecruitersDetail = async (ref: BoardRef, job: BoardJob): Promise<Omit<FetchedPosting, "url" | "source">> => {
  const d = await request<SmartRecruitersDetail>(
    `https://api.smartrecruiters.com/v1/companies/${enc(ref.slug)}/postings/${enc(job.id)}`,
  );
  if (!d) throw new PostingFetchError("not_found", `SmartRecruiters posting ${job.id} not found`);
  const sections = Object.values(d.jobAd?.sections ?? {}).map((s) => `${s.title ?? ""}\n${htmlToText(s.text ?? "")}`);
  return {
    title: d.name,
    company: d.company?.name,
    requisitionId: d.refNumber,
    datePosted: d.releasedDate,
    text: [d.name, ...sections].filter(Boolean).join("\n\n"),
  };
};

type WorkableList = {
  name?: string;
  jobs?: Array<{
    title: string;
    shortcode: string;
    url?: string;
    application_url?: string;
    description?: string;
    city?: string;
    state?: string;
  }>;
};

const listWorkable = async (ref: BoardRef): Promise<BoardListing | null> => {
  const list = await request<WorkableList>(
    `https://apply.workable.com/api/v1/widget/accounts/${enc(ref.slug)}?details=true`,
  );
  if (!list) return null;
  return {
    ref,
    companyName: list.name,
    jobs: (list.jobs ?? []).map((j) => ({
      id: j.shortcode,
      title: j.title,
      url: j.url ?? `https://apply.workable.com/${ref.slug}/j/${j.shortcode}`,
      location: [j.city, j.state].filter(Boolean).join(", ") || undefined,
      text: j.description ? [j.title, htmlToText(j.description)].join("\n\n") : undefined,
    })),
  };
};

type WorkdaySearch = {
  jobPostings?: Array<{ title: string; externalPath: string; bulletFields?: string[]; locationsText?: string }>;
};

const listWorkday = async (ref: BoardRef, query?: string): Promise<BoardListing | null> => {
  const wd = ref.workday;
  if (!wd || !query) return null;
  const res = await request<WorkdaySearch>(`${wd.origin}/wday/cxs/${enc(wd.tenant)}/${enc(wd.site)}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: query }),
  });
  if (!res) return null;
  return {
    ref,
    jobs: (res.jobPostings ?? []).map((j) => ({
      id: j.externalPath,
      title: j.title,
      url: `${wd.origin}/${wd.site}${j.externalPath}`,
      requisitionId: j.bulletFields?.find((f) => /\d{4,}/.test(f)),
      location: j.locationsText,
    })),
  };
};

/** List (or search, for SmartRecruiters and Workday) one board. Null means the board doesn't exist. */
export const listBoard = (ref: BoardRef, query?: string): Promise<BoardListing | null> => {
  switch (ref.ats) {
    case "greenhouse":
      return listGreenhouse(ref);
    case "lever":
      return listLever(ref);
    case "ashby":
      return listAshby(ref);
    case "smartrecruiters":
      return listSmartRecruiters(ref, query);
    case "workable":
      return listWorkable(ref);
    case "workday":
      return listWorkday(ref, query);
  }
};

/** Full posting text for a board job, with the shared closed/too-short checks. */
export const fetchBoardJob = async (listing: BoardListing, job: BoardJob): Promise<FetchedPosting> => {
  if (listing.ref.ats === "smartrecruiters") {
    return validatePosting(await smartRecruitersDetail(listing.ref, job), job.url, "smartrecruiters");
  }
  if (job.text && job.text.length > 0) {
    return validatePosting(
      { title: job.title, company: listing.companyName, requisitionId: job.requisitionId, text: job.text },
      job.url,
      listing.ref.ats,
    );
  }
  const posting = await fetchPosting(job.url);
  return { ...posting, requisitionId: posting.requisitionId ?? job.requisitionId, company: posting.company ?? listing.companyName };
};

const compact = (s: string) => normalizeCompany(s).replace(/\s+/g, "");

/** `Ellipsis Labs` -> [`ellipsislabs`, `ellipsis-labs`, `ellipsis`], then sender domain roots. */
export const slugCandidates = (company: string, senderRoots: string[] = []): string[] => {
  const words = normalizeCompany(company).split(/\s+/).filter(Boolean);
  const raw = company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const out = [words.join(""), words.join("-"), raw, ...senderRoots, words[0] ?? ""];
  return [...new Set(out.filter((s) => s.length >= 2))];
};

/** Exact after normalization (suffixes like Inc/Labs/Group dropped); prefixes are how collisions slip in. */
const namesMatch = (a: string, b: string): boolean => {
  const x = compact(a);
  return Boolean(x) && x === compact(b);
};

/**
 * Collision guard for guessed slugs: a board only counts as this company's when its name,
 * the company's email domain, or (for nameless boards) an exact slug plus a mention in the JDs agrees.
 */
export const boardConfirmsCompany = (
  listing: BoardListing,
  company: string,
  opts: { fromEmail?: boolean; senderRoots?: string[] } = {},
): boolean => {
  if (opts.fromEmail) return true;
  const slugCompact = listing.ref.slug.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (opts.senderRoots?.some((r) => r.toLowerCase().replace(/[^a-z0-9]+/g, "") === slugCompact)) return true;
  if (listing.companyName) return namesMatch(listing.companyName, company);
  const rawName = company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const slugFits = slugCompact === compact(company) || slugCompact === rawName.replace(/ /g, "");
  if (!slugFits || slugCompact.length < MIN_EXACT_SLUG_CHARS) return false;
  const mention = new RegExp(rawName.replace(/ /g, "[^a-z0-9]*"), "i");
  return listing.jobs.some((j) => j.text && mention.test(j.text));
};

type CacheDoc = {
  _id: string;
  boards: BoardRef[];
  miss: boolean;
  checkedAt: string;
};

export const atsBoardsRepository = {
  async collection() {
    const db = await getDb();
    return db.collection<CacheDoc>("ats_boards");
  },
  async get(companyKey: string): Promise<CacheDoc | null> {
    const col = await this.collection();
    return col.findOne({ _id: companyKey });
  },
  async put(companyKey: string, boards: BoardRef[]): Promise<void> {
    const col = await this.collection();
    await col.replaceOne(
      { _id: companyKey },
      { boards, miss: boards.length === 0, checkedAt: new Date().toISOString() },
      { upsert: true },
    );
  },
};

/**
 * Find the company's confirmed boards: cached refs first, otherwise probe guessed slugs on each
 * free ATS (hinted ATS first). Misses are cached for 7 days.
 */
export const discoverBoards = async (input: {
  company: string;
  query?: string;
  senderRoots: string[];
  preferAts?: AtsKind[];
}): Promise<BoardListing[]> => {
  const companyKey = normalizeCompany(input.company);
  if (!companyKey) return [];
  const cached = await atsBoardsRepository.get(companyKey).catch(() => null);
  if (cached && !cached.miss) {
    const listings = await Promise.all(cached.boards.map((ref) => listBoard(ref, input.query).catch(() => null)));
    return listings.filter((l): l is BoardListing => Boolean(l));
  }
  if (cached?.miss && Date.now() - Date.parse(cached.checkedAt) < MISS_TTL_MS) return [];

  const preferred = (input.preferAts ?? []).filter((a) => GUESSABLE_ATS.includes(a));
  const order = preferred.length ? preferred : GUESSABLE_ATS;
  const slugs = slugCandidates(input.company, input.senderRoots);
  const found: BoardListing[] = [];
  for (const ats of order) {
    const probes = await Promise.all(
      slugs.map((slug) => listBoard({ ats, slug }, input.query).catch(() => null)),
    );
    const confirmed = probes.find(
      (l): l is BoardListing =>
        Boolean(l) && boardConfirmsCompany(l!, input.company, { senderRoots: input.senderRoots }),
    );
    if (confirmed) {
      found.push(confirmed);
      break;
    }
  }
  await atsBoardsRepository.put(companyKey, found.map((l) => l.ref)).catch(() => undefined);
  return found;
};

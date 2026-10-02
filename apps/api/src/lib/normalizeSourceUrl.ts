const TRACKING_PARAM_RE = /^(utm_|gh_src$|ref$|refId$|trk|source$|lever-source|fbclid$|gclid$)/i;

export const normalizeSourceUrl = (raw?: string): string | undefined => {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (!/^https?:$/.test(url.protocol)) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    const out = url.toString();
    return out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return undefined;
  }
};

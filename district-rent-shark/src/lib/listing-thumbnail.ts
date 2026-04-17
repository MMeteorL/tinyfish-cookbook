/**
 * Resolve listing card thumbnails from TinyFish JSON: merge explicit fields, nested URLs,
 * and description text; prefer property photos over poster avatars; upgrade small CDN resizes.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Batdongsan-style CDNs: bump tiny resize thumbs to a usable card size. */
export function upgradeResizeUrl(url: string): string {
  return url.replace(
    /\/resize\/(\d{2,4})x(\d{2,4})\//gi,
    (match, wStr: string, hStr: string) => {
      const w = Number(wStr);
      const h = Number(hStr);
      if (
        Number.isFinite(w) &&
        Number.isFinite(h) &&
        w > 0 &&
        h > 0 &&
        w <= 360 &&
        h <= 360
      ) {
        return "/resize/800x600/";
      }
      return match;
    },
  );
}

function parseResizeDims(url: string): { w: number; h: number } | null {
  const m = url.match(/\/resize\/(\d{2,4})x(\d{2,4})\//i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { w, h };
}

/** High-confidence poster / profile imagery — deprioritize when other URLs exist. */
export function isStrongAvatarUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const full = url.toLowerCase();
    if (/\/avatar[\/._-]/i.test(path) || path.includes("/avatar/") || path.endsWith("/avatar"))
      return true;
    if (
      full.includes("profile_pic") ||
      full.includes("profile-pic") ||
      full.includes("profilepic")
    )
      return true;
    if (full.includes("user_avatar") || full.includes("user-avatar")) return true;
    if (
      path.includes("/users/") &&
      (path.includes("photo") || path.includes("avatar"))
    )
      return true;
    if (full.includes("publisher_logo") || full.includes("publisher-logo")) return true;
    return false;
  } catch {
    return false;
  }
}

function normalizeHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("//")) return `https:${t}`;
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

function normalizeUrlKey(u: string): string {
  try {
    const url = new URL(u.startsWith("//") ? `https:${u}` : u);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase()}${path}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** Likely a property/listing image (not the listing HTML page). */
export function looksLikePropertyImageUrl(url: string): boolean {
  const n = normalizeHttpUrl(url);
  if (!n) return false;
  try {
    const u = new URL(n);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    const full = n.toLowerCase();

    if (/\/resize\/\d+x\d+/i.test(path)) return true;
    if (/\.(jpe?g|png|webp|gif|bmp)(\?|$|#)/i.test(path)) return true;

    if (
      host.includes("chotot.com") ||
      host.includes("batdongsan.com") ||
      host.includes("cloudfront") ||
      host.includes("amazonaws.com")
    ) {
      if (
        /\/(image|img|photo|thumb|media|adimage|listing|property|resize|files|static)\b/i.test(
          path,
        )
      )
        return true;
      if (/\d{6,}/.test(path) && path.length > 25) return true;
    }

    if (/\/(image|img|photo|thumb|media|pictures)\b/i.test(path)) return true;
    if (full.includes("image") && full.includes("cdn")) return true;

    return false;
  } catch {
    return false;
  }
}

function thumbnailQualityScore(url: string): number {
  let score = 0;
  const dims = parseResizeDims(url);
  if (dims) {
    const area = dims.w * dims.h;
    score += Math.log10(area + 1) * 20;
    if (Math.max(dims.w, dims.h) >= 500) score += 40;
    const ratio = dims.w / Math.max(dims.h, 1);
    if (ratio < 0.92 || ratio > 1.08) score += 25;
    if (dims.w <= 120 && dims.h <= 120 && dims.w === dims.h) score -= 80;
  } else {
    score += 35;
  }

  if (isStrongAvatarUrl(url)) score -= 200;

  const lower = url.toLowerCase();
  if (lower.includes("logo") && !lower.includes("publisher_logo")) score -= 40;
  if (/\/resize\/\d+x\d+\//i.test(lower) && lower.includes("logo")) score -= 60;

  if (looksLikePropertyImageUrl(url)) score += 50;

  return score;
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function pullUrlsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s\])"'<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/[.,;:)\]]+$/g, "");
    const n = normalizeHttpUrl(raw);
    if (n) out.push(n);
  }
  return out;
}

function deepCollectUrls(value: unknown, out: string[], depth: number): void {
  if (depth > 8) return;

  if (typeof value === "string") {
    const n = normalizeHttpUrl(value);
    if (n) out.push(n);
    if (value.length > 12 && /https?:\/\//i.test(value)) {
      out.push(...pullUrlsFromText(value));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) deepCollectUrls(v, out, depth + 1);
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, v] of Object.entries(value)) {
    if (key === "listing_url") continue;
    deepCollectUrls(v, out, depth + 1);
  }
}

export function collectThumbnailCandidates(listing: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (s: unknown) => {
    if (typeof s === "string" && s.trim()) {
      const n = normalizeHttpUrl(s.trim());
      if (n) out.push(n);
    }
  };

  add(listing.thumbnail_url);
  add(listing.thumbnailUrl);
  add(listing.image_url);
  add(listing.photo_url);

  for (const key of [
    "thumbnail_candidates",
    "thumbnail_image_urls",
    "image_urls",
    "images",
    "photos",
  ] as const) {
    const extra = listing[key];
    if (Array.isArray(extra)) {
      for (const x of extra) {
        if (typeof x === "string") add(x);
        else if (isRecord(x) && typeof x.url === "string") add(x.url);
        else if (isRecord(x) && typeof x.src === "string") add(x.src);
      }
    }
  }

  const desc = listing.description_en;
  if (typeof desc === "string") out.push(...pullUrlsFromText(desc));

  deepCollectUrls(listing, out, 0);

  return dedupeUrls(out);
}

function filterOutListingPage(urls: string[], listingPageUrl: string | null): string[] {
  if (!listingPageUrl) return urls;
  const listingKey = normalizeUrlKey(listingPageUrl);
  return urls.filter((u) => normalizeUrlKey(u) !== listingKey);
}

export function pickBestListingThumbnail(
  candidates: string[],
  listingPageUrl?: string | null,
): string | null {
  let httpUrls = dedupeUrls(candidates)
    .map((u) => normalizeHttpUrl(u))
    .filter((u): u is string => u !== null);

  httpUrls = filterOutListingPage(httpUrls, listingPageUrl ?? null);

  if (httpUrls.length === 0) return null;

  const imageLike = httpUrls.filter(looksLikePropertyImageUrl);
  const pool = imageLike.length > 0 ? imageLike : httpUrls;

  const nonStrong = pool.filter((u) => !isStrongAvatarUrl(u));
  const scorePool = nonStrong.length > 0 ? nonStrong : pool;

  let best = scorePool[0]!;
  let bestScore = thumbnailQualityScore(best);
  for (let i = 1; i < scorePool.length; i++) {
    const u = scorePool[i]!;
    const s = thumbnailQualityScore(u);
    if (s > bestScore) {
      best = u;
      bestScore = s;
    }
  }

  return upgradeResizeUrl(best);
}

export function sanitizeListingResultThumbnails(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.listings)) return value;

  const sanitizedListings = value.listings.map((l) => {
    if (!isRecord(l)) return l;
    const listingUrl =
      typeof l.listing_url === "string" ? l.listing_url.trim() : null;
    const candidates = collectThumbnailCandidates(l);
    const best = pickBestListingThumbnail(candidates, listingUrl);
    const next: Record<string, unknown> = { ...l };
    delete next.thumbnail_candidates;
    delete next.thumbnail_image_urls;
    delete next.image_urls;
    if (best) {
      next.thumbnail_url = best;
    } else {
      next.thumbnail_url = null;
    }
    return next;
  });

  return { ...value, listings: sanitizedListings };
}

import { describe, it, expect } from "vitest";
import {
  pickBestListingThumbnail,
  upgradeResizeUrl,
  isStrongAvatarUrl,
  sanitizeListingResultThumbnails,
  collectThumbnailCandidates,
} from "@/lib/listing-thumbnail";

describe("upgradeResizeUrl", () => {
  it("upgrades tiny resize segments to a larger card size", () => {
    const u =
      "https://file4.batdongsan.com.vn/resize/200x200/2024/01/01/foo.jpg";
    expect(upgradeResizeUrl(u)).toContain("/resize/800x600/");
  });

  it("leaves large resize URLs unchanged", () => {
    const u = "https://cdn.example.com/resize/800x600/x/y.jpg";
    expect(upgradeResizeUrl(u)).toBe(u);
  });
});

describe("pickBestListingThumbnail", () => {
  it("prefers a property image over a poster avatar URL", () => {
    const best = pickBestListingThumbnail([
      "https://cdn.site.com/users/avatar_123.jpg",
      "https://cdn.site.com/listings/abc/photo-1.jpg",
    ]);
    expect(best).toContain("listings/abc");
  });

  it("keeps a Batdongsan-style listing thumb when no avatar alternative is listed", () => {
    const u =
      "https://file4.batdongsan.com.vn/resize/200x200/2024/01/01/property.jpg";
    const best = pickBestListingThumbnail([u]);
    expect(best).toContain("/resize/800x600/");
  });

  it("ignores the listing page URL but keeps image CDN links", () => {
    const listingPage = "https://batdongsan.com.vn/cho-thue-can-ho-xyz";
    const best = pickBestListingThumbnail(
      [listingPage, "https://file4.batdongsan.com.vn/resize/200x200/a/b.jpg"],
      listingPage,
    );
    expect(best).toContain("file4.batdongsan.com.vn");
  });

  it("falls back to any http candidate when none match image heuristics", () => {
    const best = pickBestListingThumbnail([
      "https://edge-cdn.example.net/v1/asset-without-ext-or-resize",
    ]);
    expect(best).toBe(
      "https://edge-cdn.example.net/v1/asset-without-ext-or-resize",
    );
  });
});

describe("isStrongAvatarUrl", () => {
  it("detects obvious avatar paths", () => {
    expect(isStrongAvatarUrl("https://x.com/path/avatar/face.png")).toBe(true);
    expect(isStrongAvatarUrl("https://x.com/img/profile_pic.jpg")).toBe(true);
  });

  it("does not treat generic listing paths as avatars", () => {
    expect(
      isStrongAvatarUrl(
        "https://file4.batdongsan.com.vn/resize/200x200/a/b.jpg",
      ),
    ).toBe(false);
  });
});

describe("collectThumbnailCandidates", () => {
  it("finds URLs in nested objects and description text", () => {
    const c = collectThumbnailCandidates({
      title_en: "x",
      listing_url: "https://site.com/listing/1",
      description_en: "See https://cdn.site.com/img/99.jpg for details",
      media: { hero: "https://cdn.site.com/gallery/a.png" },
    });
    expect(c.some((u) => u.includes("gallery/a.png"))).toBe(true);
    expect(c.some((u) => u.includes("img/99.jpg"))).toBe(true);
  });
});

describe("sanitizeListingResultThumbnails", () => {
  it("merges thumbnail_url and thumbnail_candidates and strips extra fields", () => {
    const out = sanitizeListingResultThumbnails({
      platform: "X",
      city: "Y",
      listings: [
        {
          title_en: "t",
          thumbnail_url: "https://cdn.com/avatar.png",
          thumbnail_candidates: [
            "https://cdn.com/avatar.png",
            "https://cdn.com/listing.jpg",
          ],
        },
      ],
    }) as Record<string, unknown>;

    const listings = out.listings as Record<string, unknown>[];
    expect(listings[0].thumbnail_url).toBe("https://cdn.com/listing.jpg");
    expect(listings[0].thumbnail_candidates).toBeUndefined();
  });

  it("fills thumbnail from a nested field when thumbnail_url is missing", () => {
    const out = sanitizeListingResultThumbnails({
      platform: "X",
      city: "Y",
      listings: [
        {
          title_en: "t",
          listing_url: "https://batdongsan.com.vn/cho-thue-x",
          gallery: {
            main: "https://file4.batdongsan.com.vn/resize/200x200/2024/x/y.jpg",
          },
        },
      ],
    }) as Record<string, unknown>;

    const listings = out.listings as Record<string, unknown>[];
    expect(String(listings[0].thumbnail_url)).toContain("file4.batdongsan.com.vn");
  });
});

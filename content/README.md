# Content

Everything the site shows lives here as plain JSON files, edited in the admin at `/admin` (Sveltia CMS) or by hand.
Each file holds both languages side by side: `en` (default) and `ka` (Georgian). Fields that are the same in both
languages (year, images, order...) live only under `en`.

```
content/
  projects/<slug>/project.json   one project: title, short description, sections, chips, cover, gallery, home-strip card, search texts
  blog/<slug>/post.json          one blog post: title, date, cover, excerpt, the article as Markdown (## headings start sections), search texts
  shots/<group>.json             one shot group = one bubble at the top of the home page: name, label, its 4:5 clips
                                 (the bubble's still + hover loop are made from the FIRST clip by tools/bubbles.mjs into
                                 assets/shots/auto/; an optional "Bubble image" replaces the still)
  pages/profile.json             the text and links in the Profile circle
  pages/contact.json             the text and links in the Contact circle
  pages/seo.json                 search title + description of the home page, the blog list, Profile and Contact
  wp-export/                     the raw WordPress export this all came from (media/ is not in git); history only
```

Media paths are written site-absolute (`/assets/img/x.webp`) so the admin can preview them; the build makes them relative.

## Addresses

Every project, post and page has its own address, the same as on the old WordPress site, in both languages:
`portfolio/<name>/` and `ge/portfolio/<name>/`, `blog/yyyy/mm/dd/<name>/` and `ge/yyyy/mm/dd/<name>/` (a post's "Page address" can
override it), `stories/`, `about/`, `contact/` and their `ge/` twins. `tools/pages.mjs` writes a real page for each one (own title,
description, share image, hreflang, JSON-LD and a readable text version) plus `sitemap.xml`. The preview is marked noindex; going live
flips that in `tools/site.mjs` (BITZ_BASE, BITZ_INDEX).

## How a change reaches the site

1. Save in the admin (or commit by hand / by Gocha). Every save is a commit to `lukamnm/bitz-site`, branch `main`.
2. The `Deploy preview` GitHub workflow runs `node tools/stage.js`: `tools/build.mjs` turns these files into `data/*.json`,
   the site is copied and every asset reference gets a content-hash stamp (bitz.ge is cached by Cloudflare for 4 hours).
3. The workflow uploads to https://bitz.ge/preview/bitz/ over FTP (needs the `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` repository secrets).
   From the laptop, `node tools/deploy.js preview` does the same through WinSCP.

Going live on bitz.ge itself is a separate, explicit step. Georgian text goes live only after Luka has signed it off.

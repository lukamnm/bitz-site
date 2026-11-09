# Content

Everything the site shows lives here as plain JSON files, edited in the admin at `/admin` (Sveltia CMS) or by hand.
Each file holds both languages side by side: `en` (default) and `ka` (Georgian). Fields that are the same in both
languages (year, images, order...) live only under `en`.

```
content/
  projects/<slug>/project.json   one project: title, short description, sections, chips, cover, gallery, home-strip card, search texts
  blog/<slug>/post.json          one blog post: title, date, cover, excerpt, the article as Markdown (## headings start sections), search texts
  shots/<group>.json             one shot group = one bubble at the top of the home page: name, label, bubble image, its 4:5 clips
  pages/profile.json             the text and links in the Profile circle
  pages/contact.json             the text and links in the Contact circle
  wp-export/                     the raw WordPress export this all came from (media/ is not in git); history only
```

Media paths are written site-absolute (`/assets/img/x.webp`) so the admin can preview them; the build makes them relative.

## How a change reaches the site

1. Save in the admin (or commit by hand / by Gocha). Every save is a commit to `lukamnm/bitz-site`, branch `main`.
2. The `Deploy preview` GitHub workflow runs `node tools/stage.js`: `tools/build.mjs` turns these files into `data/*.json`,
   the site is copied and every asset reference gets a content-hash stamp (bitz.ge is cached by Cloudflare for 4 hours).
3. The workflow uploads to https://bitz.ge/preview/bitz/ over FTP (needs the `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` repository secrets).
   From the laptop, `node tools/deploy.js preview` does the same through WinSCP.

Going live on bitz.ge itself is a separate, explicit step. Georgian text goes live only after Luka has signed it off.

# Content

Everything the site shows lives here as plain files. Both languages sit side by side in each file (`en`, `ge`).
Georgian text goes live only after Luka has signed it off.

```
content/
  projects/<slug>/project.json   title, blurb, sections, year, client, cats, link, cover, gallery, home media, seo (en + ge)
  stories/<slug>/story.json      title, excerpt, date, cover, categories, tags, seo (en + ge)
  stories/<slug>/body.en.html    the article body (clean HTML: p, h2-h4, ul/ol, a, strong, em, img)
  stories/<slug>/body.ge.html    the Georgian body, when it exists
  shots/shots.json               the shot bubbles: 4 groups, each with a ring image and its videos
  pages/about.json, contact.json the About and Contact texts as ordered blocks (en + ge) + the cleaned HTML next to them
  wp-export/                     the raw WordPress export this was generated from (media/ is not in git)
```

Media: images under `assets/` (committed). Videos under `assets/video/` (not in git, deployed from the working folder).

`data/*.json` are generated for the app by `node tools/build-content.mjs` from this folder. Edit the content files, not `data/`.
Preview deploy: `node tools/deploy.js preview` uploads to https://bitz.ge/preview/bitz/ (never the live site).

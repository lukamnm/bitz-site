// preview.js - the admin's preview of a draft, before it is saved and long before the deploy lands:
//   - the editor's preview pane shows the real site (in an iframe, at the pane's width: the phone layout) with the unsaved entry in it
//   - a "Preview" button at the bottom right of the admin opens the site in a new tab for the desktop view
// Both are the site itself opened with ?preview: it reports "ready" to the window that framed or opened it and gets the draft back by
// postMessage, again on every change, without reloading (app.js, "preview"). The draft is turned into the site's data format by the
// same admin/content.js the deploy uses, so what you see is what will build. Files picked but not yet uploaded are blob: addresses,
// which the site can show because it runs on this same origin.
import * as C from './content.js';

const SITE = new URL('../', import.meta.url).href, PREVIEW_URL = SITE + '?preview=1';
const toJS = x => (x && typeof x.toJS === 'function' ? x.toJS() : x);

// the editor's entry -> { type, kind, slug, item }, item in the site's data format; null for an entry the site has no view for
function draftOf(entry) {
  const e = toJS(entry); if (!e) return null;
  const coll = e.collection, slug = e.slug || 'draft';
  const other = toJS(e.i18n) || {};
  const loc = k => { const v = other[k]; return v ? toJS(v.data !== undefined ? v.data : v) : null; };
  let en = toJS(e.data) || {}, ka;
  if (loc('en')) { ka = en; en = loc('en'); } else ka = loc('ka') || {};   // "data" is the locale being previewed; the other sits under i18n
  const base = { type: 'bitz:draft', slug };
  if (coll === 'projects') return { ...base, kind: 'project', item: C.project(slug, en, ka) };
  if (coll === 'blog') return { ...base, kind: 'story', item: C.story(slug, en, ka) };
  if (coll === 'shots') { const g = C.shotGroup(en, ka); return g ? { ...base, kind: 'shots', item: g } : null; }
  if (slug === 'profile' || slug === 'contact') return { ...base, kind: slug, item: C.overlay(en, ka) };
  return null;
}

// ---------------------------------------------------------------- the preview pane: the site in an iframe, fed the draft
const { useEffect, useRef } = CMS.React;
const Preview = ({ entry, window: win }) => {
  const d = draftOf(entry), box = useRef(null), st = useRef({ frame: null, ready: false, latest: null });
  st.current.latest = d;
  useEffect(() => {                                       // once: the site; it says when it is ready for the draft
    const s = st.current, f = win.document.createElement('iframe');
    f.src = PREVIEW_URL; f.className = 'bz-site'; box.current.appendChild(f); s.frame = f;
    const onMsg = e => { if (e.source === f.contentWindow && e.data?.type === 'bitz:preview-ready') { s.ready = true; if (s.latest) f.contentWindow.postMessage(s.latest, '*'); } };
    win.addEventListener('message', onMsg);
    return () => { win.removeEventListener('message', onMsg); f.remove(); };
  }, []);
  useEffect(() => {                                       // every change: into the frame, and to the admin page for the new-tab preview
    if (!d) return;
    const s = st.current; if (s.ready && s.frame) s.frame.contentWindow.postMessage(d, '*');
    win.parent.postMessage(d, '*');
  });
  return html`<div class="bz-preview">
    <div class="bz-bar">${d ? 'Draft preview. This width shows the phone layout; "Preview" at the bottom right opens the desktop view in a new tab.' : 'There is no page preview for this entry.'}</div>
    <div class="bz-box" ref=${box}></div>
  </div>`;
};
CMS.registerPreviewStyle('html,body{margin:0;height:100%;background:#fff}.bz-preview{position:fixed;inset:0;display:flex;flex-direction:column;font:12px/1.4 system-ui,sans-serif}'
  + '.bz-bar{flex:none;padding:7px 12px;background:#111;color:#fff}.bz-box{flex:1;min-height:0}.bz-site{display:block;width:100%;height:100%;border:0}', { raw: true });
for (const name of ['projects', 'blog', 'shots', 'profile', 'contact']) CMS.registerPreviewTemplate(name, Preview);

// ---------------------------------------------------------------- the admin page: the "Preview" button and the new-tab preview window
let latest = null, tab = null, tabReady = false;
const btn = document.createElement('button');
btn.type = 'button'; btn.textContent = 'Preview ↗'; btn.hidden = true;
btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 16px;border:0;border-radius:999px;background:#111;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.25)';
btn.title = 'Open the site in a new tab with this draft in it (desktop view)';
document.body.appendChild(btn);
btn.addEventListener('click', () => {
  if (tab && !tab.closed) { if (tabReady && latest) tab.postMessage(latest, '*'); tab.focus(); return; }
  tabReady = false; tab = window.open(PREVIEW_URL, 'bitz-preview');
});
addEventListener('message', e => {
  const m = e.data; if (!m || typeof m !== 'object') return;
  if (m.type === 'bitz:draft' && e.source !== window) {   // from the preview pane: remember it, pass it on to the open tab
    latest = m; btn.hidden = false;
    if (tab && !tab.closed && tabReady) tab.postMessage(m, '*');
  }
  if (m.type === 'bitz:preview-ready' && tab && e.source === tab) { tabReady = true; if (latest) tab.postMessage(latest, '*'); }
});
const inEditor = () => /\/(entries|new)\b/.test(location.hash) || /\/files\//.test(location.hash);
addEventListener('hashchange', () => { if (!inEditor()) { btn.hidden = true; latest = null; } });

// preview.js - the admin's preview of a draft, before it is saved and long before the deploy lands:
//   - the editor's preview pane shows the real site (in an iframe) with the unsaved entry in it; a switch in its bar shows it as a
//     desktop (scaled to fit the pane) or a phone, and "Open in a new tab" opens the same draft full size
//   - a "Preview" button at the bottom right of the admin page does the same (it shows once a draft has been seen)
// Both are the site itself opened with ?preview: it reports "ready" to the window that framed or opened it and gets the draft back by
// postMessage, again on every change, without reloading (app.js, "preview"). The draft is turned into the site's data format by the
// same admin/content.js the deploy uses, so what you see is what will build. Files picked but not yet uploaded are blob: addresses,
// which the site can show because it runs on this same origin.
// Note: this script, the pane's React component included, runs in the admin's top window; the pane is a frame the editor renders into.
// So a message the component posts carries the top window as its source, and the component and the "Preview" button share this scope.
import * as C from './content.js';

const SITE = new URL('../', import.meta.url).href, PREVIEW_URL = SITE + '?preview=1';
const DESKTOP_W = 1280;   // the width the "Desktop" view renders at before it is scaled to fit the pane
// the editor's entry comes as Immutable maps or Svelte state proxies; a JSON round trip makes plain data of it, which postMessage can clone
const plain = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x && typeof x.toJS === 'function' ? x.toJS() : x)));

// the editor's entry -> { type, kind, slug, item }, item in the site's data format; null for an entry the site has no view for
function draftOf(entry) {
  const e = plain(entry); if (!e) return null;
  const coll = typeof e.collection === 'string' ? e.collection : e.collection?.name || e.collectionName, slug = e.slug || 'draft';
  const other = e.i18n || {};
  const loc = k => { const v = other[k]; return v ? (v.data !== undefined ? v.data : v) : null; };
  let en = e.data || {}, ka;
  if (loc('en')) { ka = en; en = loc('en'); } else ka = loc('ka') || {};   // "data" is the locale being previewed; the other sits under i18n
  const base = { type: 'bitz:draft', slug };
  if (coll === 'projects') return { ...base, kind: 'project', item: C.project(slug, en, ka) };
  if (coll === 'blog') return { ...base, kind: 'story', item: C.story(slug, en, ka) };
  if (coll === 'shots') { const g = C.shotGroup(en, ka); return g ? { ...base, kind: 'shots', item: g } : null; }
  if (slug === 'profile' || slug === 'contact') return { ...base, kind: slug, item: C.overlay(en, ka) };
  return null;
}

// ---------------------------------------------------------------- the admin page: the new-tab preview window (and a "Preview" button)
let latest = null, tab = null, tabReady = false;
const openTab = () => {
  if (tab && !tab.closed) { if (tabReady && latest) tab.postMessage(latest, '*'); tab.focus(); return; }
  tabReady = false; tab = window.open(PREVIEW_URL, 'bitz-preview');
};
const gotDraft = d => {                                    // from the pane: remember the draft, pass it on to the open tab
  latest = d; btn.hidden = false;
  if (tab && !tab.closed && tabReady) tab.postMessage(latest, '*');
};
const btn = document.createElement('button');
btn.type = 'button'; btn.textContent = 'Preview ↗'; btn.hidden = true;
btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 16px;border:0;border-radius:999px;background:#111;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.25)';
btn.title = 'Open the site in a new tab with this draft in it';
document.body.appendChild(btn);
btn.addEventListener('click', openTab);
addEventListener('message', e => {
  const m = e.data; if (!m || typeof m !== 'object') return;
  if (m.type === 'bitz:preview-ready' && tab && e.source === tab) { tabReady = true; if (latest) tab.postMessage(latest, '*'); }
});
const inEditor = () => /\/(entries|new)\b/.test(location.hash) || /\/files\//.test(location.hash);
addEventListener('hashchange', () => { if (!inEditor()) { btn.hidden = true; latest = null; } });

// ---------------------------------------------------------------- the preview pane: the site in an iframe, fed the draft
const { useEffect, useRef, useState } = CMS.React;
const Preview = ({ entry, window: win }) => {
  const box = useRef(null), st = useRef({ frame: null, ready: false, latest: null, phone: false });
  const [status, setStatus] = useState('loading the site'), [phone, setPhone] = useState(false);
  let d = null, problem = null;
  try { d = draftOf(entry); } catch (err) { problem = err; console.error('[bitz preview] the draft could not be built', err); }
  st.current.latest = d; st.current.phone = phone;
  const send = (target, msg) => { try { target.postMessage(msg, '*'); return true; } catch (err) { setStatus('could not send the draft: ' + err.message); console.error('[bitz preview]', err); return false; } };
  // the frame's size: a phone at its own width, or a desktop rendered at DESKTOP_W and scaled down to the pane's width
  const layout = () => {
    const s = st.current, b = box.current, f = s.frame; if (!b || !f) return;
    if (s.phone) { f.style.cssText = 'width:390px;max-width:100%;height:100%;transform:none'; return; }
    const k = Math.min(1, b.clientWidth / DESKTOP_W);
    f.style.cssText = `width:${DESKTOP_W}px;height:${b.clientHeight / k}px;transform:scale(${k});transform-origin:0 0`;
  };
  useEffect(() => {                                       // once: the site; it says when it is ready for the draft
    const s = st.current, f = win.document.createElement('iframe');
    f.src = PREVIEW_URL; f.className = 'bz-site'; box.current.appendChild(f); s.frame = f; layout();
    const ro = new win.ResizeObserver(layout); ro.observe(box.current);
    const onMsg = e => {
      if (e.source !== f.contentWindow || e.data?.type !== 'bitz:preview-ready') return;
      s.ready = true;
      if (s.latest) { if (send(f.contentWindow, s.latest)) setStatus('live, it follows your edits'); } else setStatus('nothing to show for this entry');
    };
    win.addEventListener('message', onMsg);
    return () => { win.removeEventListener('message', onMsg); ro.disconnect(); f.remove(); };
  }, []);
  useEffect(layout, [phone]);
  useEffect(() => {                                       // every change: into the frame, and to the admin page for the new-tab preview
    if (!d) return;
    const s = st.current;
    if (s.ready && s.frame) send(s.frame.contentWindow, d);
    gotDraft(d);
  });
  const text = problem ? 'the draft could not be built: ' + problem.message : d ? status : 'there is no page preview for this entry';
  return html`<div class="bz-preview">
    <div class="bz-bar">
      <span class="bz-status">Draft preview: ${text}</span>
      <span class="bz-tools">
        <button type="button" class=${phone ? '' : 'on'} onClick=${() => setPhone(false)}>Desktop</button>
        <button type="button" class=${phone ? 'on' : ''} onClick=${() => setPhone(true)}>Phone</button>
        <button type="button" class="go" onClick=${openTab} disabled=${!d}>Open in a new tab ↗</button>
      </span>
    </div>
    <div class=${'bz-box' + (phone ? ' phone' : '')} ref=${box}></div>
  </div>`;
};
CMS.registerPreviewStyle(
  'html,body{margin:0;height:100%;background:#1b1b1b}'
  + '.bz-preview{position:fixed;inset:0;display:flex;flex-direction:column;font:12px/1.4 system-ui,sans-serif;color:#fff}'
  + '.bz-bar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;background:#111}'
  + '.bz-status{opacity:.85}.bz-tools{display:flex;gap:6px;flex:none}'
  + '.bz-tools button{border:1px solid #444;background:#222;color:#fff;border-radius:999px;padding:4px 10px;font:inherit;cursor:pointer}'
  + '.bz-tools button.on{background:#fff;color:#111;border-color:#fff}.bz-tools button.go{border-color:#888}.bz-tools button:disabled{opacity:.4;cursor:default}'
  + '.bz-box{flex:1;min-height:0;position:relative;overflow:hidden;background:#1b1b1b}.bz-box.phone{display:flex;justify-content:center}'
  + '.bz-site{display:block;border:0;background:#000}',
  { raw: true });
for (const name of ['projects', 'blog', 'shots', 'profile', 'contact']) CMS.registerPreviewTemplate(name, Preview);

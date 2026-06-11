
/* ══════════════════════════════════════════════════
   PENCRAFT NOTES  ·  v1.0
══════════════════════════════════════════════════ */

/* ── PDF.js setup ── */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ── Constants ── */
const KEY  = 'pencraft_v2';

/* ── State ── */
let notes   = [];
let cur     = null;   // current note id
let timer   = null;   // auto-save timer
let dirty   = false;
let sortMode = localStorage.getItem('pencraft_sort') || 'modified-desc';
let selMode  = false;
let selected = new Set();
let lpTimer  = null;  // long-press timer

/* ── DOM ── */
const $ = id => document.getElementById(id);
const notesList  = $('notesList');
const searchInp  = $('searchInp');
const welcome    = $('welcome');
const editorUI   = $('editorUI');
const titleInp   = $('titleInp');
const editor     = $('editor');
const wcEl       = $('wc');
const ccEl       = $('cc');
const saveInd    = $('saveInd');
const saveTxt    = $('saveTxt');
const dtInp      = $('dtInp');
const dtToggle   = $('dtToggle');

/* ── Date/Time helpers ── */
function dtToLocalInput(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dtFromLocalInput(v) {
  const t = new Date(v).getTime();
  return isNaN(t) ? Date.now() : t;
}
function refreshDtUI() {
  const n = cur ? getNote(cur) : null;
  if (!n) return;
  dtInp.value = dtToLocalInput(n.dateTime || n.modified || Date.now());
  const auto = (n.dateMode || 'auto') === 'auto';
  dtToggle.classList.toggle('auto', auto);
  dtToggle.querySelector('.dt-mode-txt').textContent = auto ? 'Auto' : 'Fixed';
  dtToggle.title = auto
    ? 'Auto-updating on edit — click to keep fixed'
    : 'Fixed date/time — click to auto-update on edit';
}

/* ═══════════════════════════════
   SIDEBAR TOGGLE
═══════════════════════════════ */
function toggleSidebar(force) {
  const sb   = document.querySelector('.sidebar');
  const ov   = $('sbOverlay');
  const open = force !== undefined ? force : !sb.classList.contains('sb-open');
  sb.classList.toggle('sb-open', open);
  ov.classList.toggle('open', open);
}

/* ═══════════════════════════════
   STORAGE
═══════════════════════════════ */
function loadNotes() {
  try { notes = JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { notes = []; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(notes)); }
  catch { toast('Storage full — note not saved', 'err'); }
}

/* ═══════════════════════════════
   UTILS
═══════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ago(ts) {
  const d = Date.now() - ts,
        m = 60e3, h = 3600e3, dy = 86400e3;
  if (d < m)       return 'just now';
  if (d < h)       return Math.floor(d/m) + 'm ago';
  if (d < dy)      return Math.floor(d/h) + 'h ago';
  if (d < 7*dy)    return Math.floor(d/dy) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

function plain(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || d.innerText || '';
}

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function safeName(s) {
  return (s || 'note').replace(/[^\w\s\-]/g, '').trim() || 'note';
}

/* Derive a display title from content when no explicit title is set */
function noteTitle(n) {
  if (n.title && n.title.trim()) return n.title.trim();
  const text = plain(n.content).trim();
  if (!text) return 'New note';
  const first = text.split(/\n/)[0].trim().replace(/\s+/g, ' ');
  return first.length > 52 ? first.slice(0, 52).trimEnd() + '…' : first || 'New note';
}

function download(name, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ═══════════════════════════════
   NOTE OPERATIONS
═══════════════════════════════ */
function createNote() {
  const note = {
    id: uid(), title: '', content: '',
    created: Date.now(), modified: Date.now(),
    dateTime: Date.now(), dateMode: 'auto'
  };
  notes.unshift(note);
  persist();
  renderList();
  openNote(note.id);
  titleInp.focus();
}

function createNoteFromExport(title, contentHtml) {
  if (dirty) commitSave();
  const note = {
    id: uid(), title: (title || '').trim(), content: contentHtml || '',
    created: Date.now(), modified: Date.now(),
    dateTime: Date.now(), dateMode: 'auto'
  };
  notes.unshift(note);
  persist();
  renderList();
  closeTodoPanel();
  closeMapPanel();
  openNote(note.id);
  toast('Exported to new note ✓', 'ok');
}

function openNote(id) {
  if (dirty) commitSave();
  cur = id;
  if (window.innerWidth <= 680) toggleSidebar(false);
  const n = getNote(id);
  if (!n) return;
  // Backward-compat for older notes
  if (!n.dateMode)  n.dateMode  = 'auto';
  if (!n.dateTime)  n.dateTime  = n.modified || Date.now();
  // Default behavior: when a note is opened (and will be edited), auto mode bumps the time
  if (n.dateMode === 'auto') {
    n.dateTime = Date.now();
    persist();
  }
  titleInp.value = n.title;
  editor.innerHTML = n.content;
  refreshDtUI();
  welcome.style.display    = 'none';
  editorUI.style.display   = 'flex';
  editorUI.style.flexDirection = 'column';
  renderList();
  updateStats();
  setSave('saved');
  dirty = false;
}

function getNote(id) { return notes.find(n => n.id === id); }

function deleteNote(id) {
  // Unlink any tasks that reference this note
  tasks.forEach(t => { if (t.sourceNoteId === id) { t.sourceNoteId = null; t.sourceNoteTitle = ''; } });
  persistTasks();
  notes = notes.filter(n => n.id !== id);
  persist();
  if (cur === id) {
    cur   = null;
    dirty = false;
    if (notes.length) {
      openNote(notes[0].id);
    } else {
      editorUI.style.display = 'none';
      welcome.style.display  = 'flex';
    }
  }
  renderList();
  toast('Note deleted');
}

function commitSave() {
  if (!cur) return;
  const n = getNote(cur);
  if (!n) return;
  n.title    = titleInp.value.trim();
  n.content  = editor.innerHTML;
  n.modified = Date.now();
  if ((n.dateMode || 'auto') === 'auto') {
    n.dateTime = Date.now();
    refreshDtUI();
  }
  persist();
  renderList();
  setSave('saved');
  dirty = false;
}

function saveAndClose() {
  if (!cur) return;
  clearTimeout(timer);
  commitSave();
  cur              = null;
  dirty            = false;
  titleInp.value   = '';
  editor.innerHTML = '';
  editorUI.style.display = 'none';
  welcome.style.display  = 'flex';
  renderList();          // re-render so no note appears active in the sidebar
  toast('Note saved ✓', 'ok');
}

/* ═══════════════════════════════
   RENDER
═══════════════════════════════ */
function renderList() {
  const q = searchInp.value.toLowerCase().trim();
  let list = q
    ? notes.filter(n => n.title.toLowerCase().includes(q) || plain(n.content).toLowerCase().includes(q))
    : notes.slice();

  /* Sort */
  const sizeOf = n => (n.title || '').length + (n.content || '').length;
  const titleOf = n => (noteTitle ? noteTitle(n) : (n.title || '')).toLowerCase();
  const cmps = {
    'modified-desc': (a,b) => (b.modified||0) - (a.modified||0),
    'modified-asc':  (a,b) => (a.modified||0) - (b.modified||0),
    'created-desc':  (a,b) => (b.created||0)  - (a.created||0),
    'created-asc':   (a,b) => (a.created||0)  - (b.created||0),
    'title-asc':     (a,b) => titleOf(a).localeCompare(titleOf(b)),
    'title-desc':    (a,b) => titleOf(b).localeCompare(titleOf(a)),
    'size-desc':     (a,b) => sizeOf(b) - sizeOf(a),
    'size-asc':      (a,b) => sizeOf(a) - sizeOf(b),
  };
  list.sort(cmps[sortMode] || cmps['modified-desc']);

  if (!list.length) {
    notesList.innerHTML = `<div class="empty-list">${
      q ? 'No notes match your search.' : 'No notes yet.<br>Create one to begin!'
    }</div>`;
    notesList.classList.toggle('sel-mode', selMode);
    updateNoteCount();
    return;
  }

  notesList.innerHTML = list.map(n => {
    const prev = plain(n.content).slice(0, 55);
    const isSel = selected.has(n.id);
    return `
    <div class="note-item${n.id === cur && !selMode ? ' active' : ''}${isSel ? ' selected' : ''}" data-id="${n.id}">
      <div class="ni-check" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="ni-title">${esc(noteTitle(n))}</div>
      <div class="ni-meta">
        <div class="ni-preview">${esc(prev || 'Empty note')}</div>
        <div class="ni-date">${ago(n.modified)}</div>
      </div>
      <button class="ni-del" data-del="${n.id}" title="Delete">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
  }).join('');
  notesList.classList.toggle('sel-mode', selMode);
  updateSelBar();
  updateNoteCount();
}

function updateNoteCount() {
  const el = document.getElementById('sbCount');
  if (!el) return;
  const total = notes.length;
  const q = searchInp && searchInp.value ? searchInp.value.toLowerCase().trim() : '';
  const shown = q
    ? notes.filter(n => n.title.toLowerCase().includes(q) || plain(n.content).toLowerCase().includes(q)).length
    : total;
  const label = total === 1 ? 'note' : 'notes';
  el.innerHTML = (q && shown !== total)
    ? `<strong>${shown}</strong> of <strong>${total}</strong> ${label}`
    : `<strong>${total}</strong> ${label}`;
}

/* ═══════════════════════════════
   MULTI-SELECT
═══════════════════════════════ */
function enterSelMode(initialId) {
  selMode = true;
  selected.clear();
  if (initialId) selected.add(initialId);
  $('selBar').classList.add('open');
  renderList();
}
function exitSelMode() {
  selMode = false;
  selected.clear();
  $('selBar').classList.remove('open');
  renderList();
}
function toggleSel(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  if (selected.size === 0) { exitSelMode(); return; }
  renderList();
}
function updateSelBar() {
  const c = selected.size;
  const el = $('selCount');
  if (el) el.textContent = `${c} selected`;
}
function bulkDeleteSelected() {
  const ids = Array.from(selected);
  // Unlink tasks referencing any deleted note
  tasks.forEach(t => { if (ids.includes(t.sourceNoteId)) { t.sourceNoteId = null; t.sourceNoteTitle = ''; } });
  persistTasks();
  notes = notes.filter(n => !selected.has(n.id));
  persist();
  if (cur && ids.includes(cur)) {
    if (notes.length) openNote(notes[0].id);
    else { cur = null; welcome.style.display = 'flex'; editorUI.style.display = 'none'; }
  }
  exitSelMode();
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════════════════
   AUTO-SAVE & STATUS
═══════════════════════════════ */
function scheduleSave() {
  dirty = true;
  setSave('unsaved');
  clearTimeout(timer);
  timer = setTimeout(() => {
    setSave('saving');
    setTimeout(commitSave, 280);
  }, 1600);
}

function setSave(st) {
  saveInd.className = `save-ind ${st}`;
  saveTxt.textContent = st === 'saving' ? 'Saving…' : st === 'saved' ? 'All saved' : 'Unsaved changes';
}

function updateStats() {
  const t = plain(editor.innerHTML);
  const w = words(t);
  const c = t.replace(/\s/g, '').length;
  wcEl.textContent = `${w} word${w !== 1 ? 's' : ''}`;
  ccEl.textContent = `${c} char${c !== 1 ? 's' : ''}`;
}

/* ═══════════════════════════════
   FORMATTING COMMANDS
═══════════════════════════════ */
function execFmt(cmd) {
  editor.focus();

  /* Headings — with toggle */
  if (/^h[1-3]$/.test(cmd)) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      let node = sel.getRangeAt(0).startContainer;
      while (node && node !== editor) {
        if (node.nodeType === 1 && node.tagName.toLowerCase() === cmd) {
          document.execCommand('formatBlock', false, 'p');
          return;
        }
        node = node.parentNode;
      }
    }
    document.execCommand('formatBlock', false, cmd);
    return;
  }

  /* Blockquote */
  if (cmd === 'blockquote') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      let node = sel.getRangeAt(0).startContainer;
      while (node && node !== editor) {
        if (node.nodeType === 1 && node.tagName === 'BLOCKQUOTE') {
          document.execCommand('formatBlock', false, 'p');
          return;
        }
        node = node.parentNode;
      }
    }
    document.execCommand('formatBlock', false, 'blockquote');
    return;
  }

  /* Inline code */
  if (cmd === 'code') {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    // Check if inside code element already
    let cn = range.commonAncestorContainer;
    if (cn.nodeType === Node.TEXT_NODE) cn = cn.parentNode;
    if (cn.tagName === 'CODE') {
      const par = cn.parentNode;
      while (cn.firstChild) par.insertBefore(cn.firstChild, cn);
      par.removeChild(cn);
      return;
    }

    if (!sel.isCollapsed) {
      const text = range.toString();
      const code = document.createElement('code');
      code.textContent = text;
      range.deleteContents();
      range.insertNode(code);
      const nr = document.createRange();
      nr.setStartAfter(code); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    return;
  }

  /* Horizontal rule */
  if (cmd === 'hr') {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const hr = document.createElement('hr');
    const p  = document.createElement('p');
    p.innerHTML = '<br>';
    range.insertNode(p);
    range.insertNode(hr);
    const nr = document.createRange();
    nr.setStart(p, 0); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    return;
  }

  /* Link */
  if (cmd === 'link') {
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount && !sel.isCollapsed ? sel.toString() : '';
    const url = prompt('Enter URL:', 'https://');
    if (!url || url === 'https://') return;
    if (sel && !sel.isCollapsed) {
      document.execCommand('createLink', false, url);
      editor.querySelectorAll('a[href]').forEach(a => {
        if (!a.target) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      });
    } else {
      const label = prompt('Link text:', url);
      if (!label) return;
      const a = document.createElement('a');
      a.href = url; a.textContent = label;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (range) { range.insertNode(a); const nr = document.createRange(); nr.setStartAfter(a); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); }
    }
    return;
  }

  /* Standard execCommand */
  document.execCommand(cmd, false, null);
}

function syncToolbar() {
  document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
    const c = btn.dataset.cmd;
    const active = [
      'bold','italic','underline','strikethrough',
      'insertUnorderedList','insertOrderedList',
      'justifyLeft','justifyCenter','justifyRight'
    ];
    if (active.includes(c)) {
      try { btn.classList.toggle('on', document.queryCommandState(c)); } catch {}
    }
  });
}

/* ═══════════════════════════════
   HTML → MARKDOWN
═══════════════════════════════ */
function toMarkdown(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const kids = () => Array.from(node.childNodes).map(walk).join('');

    switch (tag) {
      case 'b': case 'strong': return `**${kids()}**`;
      case 'i': case 'em':     return `*${kids()}*`;
      case 'u':                return `<u>${kids()}</u>`;
      case 's': case 'del': case 'strike': return `~~${kids()}~~`;
      case 'h1': return `\n\n# ${kids().trim()}\n\n`;
      case 'h2': return `\n\n## ${kids().trim()}\n\n`;
      case 'h3': return `\n\n### ${kids().trim()}\n\n`;
      case 'h4': return `\n\n#### ${kids().trim()}\n\n`;
      case 'p':  return `\n\n${kids().trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'ul': {
        const items = Array.from(node.children).map(li => `- ${walk(li).trim()}`).join('\n');
        return `\n\n${items}\n\n`;
      }
      case 'ol': {
        const items = Array.from(node.children).map((li, i) => `${i+1}. ${walk(li).trim()}`).join('\n');
        return `\n\n${items}\n\n`;
      }
      case 'li': return kids();
      case 'blockquote': {
        const lines = kids().trim().split('\n');
        return `\n\n${lines.map(l => `> ${l}`).join('\n')}\n\n`;
      }
      case 'code': return `\`${node.textContent}\``;
      case 'pre': {
        const c = node.querySelector('code');
        return `\n\n\`\`\`\n${c ? c.textContent : node.textContent}\n\`\`\`\n\n`;
      }
      case 'a':   return `[${kids()}](${node.getAttribute('href') || ''})`;
      case 'img': return `![${node.alt || ''}](${node.src || ''})`;
      case 'div': case 'section': return `\n${kids()}\n`;
      default: return kids();
    }
  }

  return walk(wrap).replace(/\n{3,}/g, '\n\n').trim();
}

/* ═══════════════════════════════
   EXPORT
═══════════════════════════════ */
function exportNote(fmt) {
  const n = getNote(cur);
  if (!n) { toast('No note to export', 'err'); return; }
  const title = noteTitle(n);
  const fname = safeName(title);

  if (fmt === 'md') {
    const md = `# ${title}\n\n${toMarkdown(n.content)}`;
    download(`${fname}.md`, md, 'text/markdown;charset=utf-8');
    toast('Exported as Markdown ✓', 'ok');
  }

  else if (fmt === 'txt') {
    const bar = '='.repeat(Math.min(title.length, 60));
    const body = plain(n.content);
    download(`${fname}.txt`, `${title}\n${bar}\n\n${body}`, 'text/plain;charset=utf-8');
    toast('Exported as plain text ✓', 'ok');
  }

  else if (fmt === 'pdf') {
    const pw = window.open('', '_blank', 'width=880,height=700');
    if (!pw) { toast('Allow popups to export PDF', 'err'); return; }
    pw.document.write(buildPrintDoc(n));
    pw.document.close();
    toast('Print dialog opened — save as PDF', 'ok');
  }

  else if (fmt === 'doc') {
    const html = buildWordDoc(n);
    download(`${fname}.doc`, '\ufeff' + html, 'application/msword');
    toast('Exported as Word document ✓', 'ok');
  }
}

function buildPrintDoc(n) {
  const d = new Date(n.created).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>${esc(noteTitle(n))}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Lora',Georgia,serif;font-size:11.5pt;line-height:1.8;color:#221c14;background:#fff;padding:2.2cm 2.5cm;max-width:none}
h1.nt{font-family:'Playfair Display',Georgia,serif;font-size:22pt;font-weight:700;margin-bottom:.25cm;color:#12100a;border-bottom:1.5pt solid #c89038;padding-bottom:.2cm}
.meta{font-size:9pt;color:#888;margin-bottom:.8cm}
h1{font-family:'Playfair Display',Georgia,serif;font-size:18pt;margin:.6cm 0 .25cm}
h2{font-family:'Playfair Display',Georgia,serif;font-size:14pt;margin:.5cm 0 .2cm}
h3{font-family:'Playfair Display',Georgia,serif;font-size:12pt;margin:.4cm 0 .18cm}
p{margin-bottom:.38cm}
ul,ol{padding-left:1.2cm;margin-bottom:.38cm}
blockquote{border-left:2.5pt solid #c89038;padding:.15cm .4cm;color:#554832;font-style:italic;margin:.4cm 0;background:#fdf8f1}
code{font-family:'Courier New',monospace;font-size:10pt;background:#f5efe4;padding:1pt 4pt;border-radius:2pt}
pre{background:#f5efe4;padding:.3cm;border-radius:4pt;margin:.4cm 0;overflow:hidden}
pre code{background:none;padding:0}
hr{border:none;border-top:.5pt solid #ccc;margin:.6cm 0}
a{color:#c89038}
@media print{body{padding:0}@page{margin:2cm 2.2cm}}
</style></head><body>
<h1 class="nt">${esc(noteTitle(n))}</h1>
<div class="meta">Created ${d} &nbsp;·&nbsp; ${words(plain(n.content))} words</div>
${n.content}
<script>window.onload=()=>{setTimeout(()=>{window.print();},600);};<\/script>
</body></html>`;
}

function buildWordDoc(n) {
  const d = new Date(n.created).toLocaleDateString();
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
xmlns:w='urn:schemas-microsoft-com:office:word'
xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="UTF-8"><title>${esc(noteTitle(n))}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.6;color:#2c2c2c;margin:2cm}
h1{font-size:20pt;color:#12100a;margin-bottom:8pt}
h2{font-size:15pt;margin-bottom:6pt}
h3{font-size:12pt;margin-bottom:4pt}
p{margin-bottom:7pt}
ul,ol{padding-left:1.2cm;margin-bottom:7pt}
blockquote{border-left:3pt solid #c89038;padding-left:9pt;color:#554832;font-style:italic;margin:8pt 0}
code{font-family:'Courier New',monospace;font-size:10pt;background:#f5efe4;padding:1pt 4pt}
pre{background:#f5efe4;padding:9pt;margin-bottom:8pt}
hr{border:none;border-top:1pt solid #ccc;margin:12pt 0}
a{color:#c89038}
</style></head><body>
<h1>${esc(noteTitle(n))}</h1>
<p style="color:#888;font-size:9pt;">Created: ${d} &nbsp;&nbsp; ${words(plain(n.content))} words</p>
<hr>
${n.content}
</body></html>`;
}

/* ═══════════════════════════════
   IMPORT
═══════════════════════════════ */
async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let title   = file.name.replace(/\.[^.]+$/, '');
  let content = '';

  try {
    if (ext === 'md') {
      const text = await readText(file);
      const m = text.match(/^#\s+(.+)/m);
      if (m) title = m[1].trim();
      content = (typeof marked !== 'undefined')
        ? marked.parse(text)
        : `<pre>${esc2(text)}</pre>`;
    }

    else if (ext === 'txt') {
      const text = await readText(file);
      content = text.split('\n').map(l =>
        l.trim() ? `<p>${esc2(l)}</p>` : ''
      ).filter(Boolean).join('');
    }

    else if (ext === 'pdf') {
      content = await importPDF(file);
    }

    else if (ext === 'doc' || ext === 'docx') {
      content = await importDOCX(file);
    }

    else {
      toast('Unsupported file type', 'err'); return;
    }

    const note = { id: uid(), title, content, created: Date.now(), modified: Date.now() };
    notes.unshift(note);
    persist();
    renderList();
    openNote(note.id);
    toast(`Imported "${title}" ✓`, 'ok');
  } catch (e) {
    console.error(e);
    toast(`Import failed: ${e.message}`, 'err');
  }
}

function readText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload  = e => res(e.target.result);
    fr.onerror = () => rej(new Error('Could not read file'));
    fr.readAsText(file, 'utf-8');
  });
}

async function importPDF(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded — check internet connection');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page  = await pdf.getPage(i);
    const items = (await page.getTextContent()).items;
    const text  = items.map(it => it.str).join(' ');
    if (text.trim()) out += `<p>${esc2(text.trim())}</p>`;
  }
  return out || '<p>(No text found in PDF)</p>';
}

async function importDOCX(file) {
  if (typeof mammoth === 'undefined') throw new Error('Mammoth.js not loaded — check internet connection');
  const buf    = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  if (result.messages?.length) console.warn('mammoth warnings:', result.messages);
  return result.value || '';
}

function esc2(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ═══════════════════════════════
   EVENT HANDLERS
═══════════════════════════════ */

/* New note */
$('btnNew').addEventListener('click', createNote);
$('btnCreateFirst').addEventListener('click', createNote);

/* Date/Time field — user-edited timestamp */
dtInp.addEventListener('input', () => {
  if (!cur) return;
  const n = getNote(cur);
  if (!n) return;
  n.dateTime = dtFromLocalInput(dtInp.value);
  // Manual edit implies the user wants this exact value preserved → switch to Fixed
  if (n.dateMode !== 'fixed') {
    n.dateMode = 'fixed';
    refreshDtUI();
  }
  scheduleSave();
});

/* Toggle between Auto-updating and Fixed date/time */
dtToggle.addEventListener('click', () => {
  if (!cur) return;
  const n = getNote(cur);
  if (!n) return;
  const goingAuto = (n.dateMode || 'auto') !== 'auto';
  n.dateMode = goingAuto ? 'auto' : 'fixed';
  if (goingAuto) n.dateTime = Date.now();
  refreshDtUI();
  scheduleSave();
  toast(goingAuto ? 'Date set to auto-update' : 'Date locked', 'info');
});

/* Save & close */
$('btnSave').addEventListener('click', saveAndClose);

/* Sidebar toggle */
$('btnHamburger').addEventListener('click', () => toggleSidebar());
$('btnHamburgerWelcome').addEventListener('click', () => toggleSidebar());
$('sbOverlay').addEventListener('click', () => toggleSidebar(false));

/* Notes list */
notesList.addEventListener('click', e => {
  const del  = e.target.closest('[data-del]');
  const item = e.target.closest('.note-item');
  if (del && !selMode)  { e.stopPropagation(); showDelModal(del.dataset.del); return; }
  if (!item) return;
  const id = item.dataset.id;
  if (!id) return;

  /* Ctrl/Shift-click enters selection mode */
  if (!selMode && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    enterSelMode(id);
    return;
  }
  if (selMode) {
    toggleSel(id);
    return;
  }
  if (id !== cur) openNote(id);
});

/* Long-press (touch) to enter selection mode */
notesList.addEventListener('touchstart', e => {
  const item = e.target.closest('.note-item');
  if (!item) return;
  const id = item.dataset.id;
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    if (!selMode) {
      if (navigator.vibrate) try { navigator.vibrate(15); } catch(_){}
      enterSelMode(id);
    }
  }, 500);
}, { passive: true });
['touchend','touchmove','touchcancel'].forEach(ev =>
  notesList.addEventListener(ev, () => clearTimeout(lpTimer), { passive: true }));

/* Right-click also enters selection mode */
notesList.addEventListener('contextmenu', e => {
  const item = e.target.closest('.note-item');
  if (!item) return;
  e.preventDefault();
  if (!selMode) enterSelMode(item.dataset.id);
  else toggleSel(item.dataset.id);
});

/* Sort */
const sortSel = $('sortSel');
if (sortSel) {
  sortSel.value = sortMode;
  sortSel.addEventListener('change', () => {
    sortMode = sortSel.value;
    localStorage.setItem('pencraft_sort', sortMode);
    renderList();
  });
}

/* Selection toolbar */
$('selCancel').addEventListener('click', exitSelMode);
$('selAll').addEventListener('click', () => {
  const q = searchInp.value.toLowerCase().trim();
  const visible = q
    ? notes.filter(n => n.title.toLowerCase().includes(q) || plain(n.content).toLowerCase().includes(q))
    : notes;
  visible.forEach(n => selected.add(n.id));
  if (selected.size === 0) exitSelMode(); else renderList();
});
$('selDel').addEventListener('click', () => {
  if (!selected.size) return;
  $('bulkDelDesc').textContent =
    `${selected.size} note${selected.size === 1 ? '' : 's'} will be permanently removed from your device. This action cannot be undone.`;
  $('bulkDelModal').classList.add('open');
});
$('cancelBulkDel').addEventListener('click', () => $('bulkDelModal').classList.remove('open'));
$('confirmBulkDel').addEventListener('click', () => {
  $('bulkDelModal').classList.remove('open');
  bulkDeleteSelected();
});

/* Search */
searchInp.addEventListener('input', renderList);

/* Title */
titleInp.addEventListener('input', scheduleSave);
titleInp.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); editor.focus(); }
});

/* Editor */
document.execCommand('defaultParagraphSeparator', false, 'p');

editor.addEventListener('input', () => { updateStats(); scheduleSave(); });
editor.addEventListener('keyup',  syncToolbar);
editor.addEventListener('mouseup', syncToolbar);
editor.addEventListener('keydown', e => {
  const meta = e.ctrlKey || e.metaKey;
  if (!meta) return;
  if (e.key === 'b') { e.preventDefault(); execFmt('bold'); }
  if (e.key === 'i') { e.preventDefault(); execFmt('italic'); }
  if (e.key === 'u') { e.preventDefault(); execFmt('underline'); }
  if (e.key === 's') { e.preventDefault(); commitSave(); toast('Note saved ✓', 'ok'); }
  if (e.key === 'n') { e.preventDefault(); createNote(); }
});

/* ══════════════════════════════════════════════════
   AUTO-NUMBERED LIST
   Triggers when a line begins with  N.  (digit + dot + space).
   • Enter on a content line  → new line pre-filled with (N+1).
   • Enter on a bare  "N. "  → exit list, leave a blank line
   • Backspace at end of prefix → strip "N. ", exit list
   • Second space on bare "N. " → same exit behaviour
   • After any deletion, renumber all sequential list items
══════════════════════════════════════════════════ */

/** Recursively find the first Text node inside an element */
function firstTextNode(el) {
  if (el.nodeType === Node.TEXT_NODE) return el;
  for (const child of el.childNodes) {
    const hit = firstTextNode(child);
    if (hit) return hit;
  }
  return null;
}

/** Character offset of the caret from the start of a block element */
function caretOffsetInBlock(blockEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const pre = document.createRange();
  pre.selectNodeContents(blockEl);
  pre.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return pre.toString().length;
}

/**
 * Return info about the list line the caret is on, or null.
 * Detects four styles:
 *   number  →  "1. "  "2. "  …
 *   alpha   →  "a. "  "b. "  …  (single letter)
 *   dash    →  "- "
 *   bullet  →  "• "
 */
function listLineInfo() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;

  let node = sel.anchorNode;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  // First line may live as a bare text node directly inside the editor
  if (node !== editor) {
    while (node && node.parentNode !== editor) node = node.parentNode;
  }
  if (!node) return null;

  const text = node.textContent;

  // 1. Numbered  "1. " "12. "
  const numM = text.match(/^(\d+)\.\s/);
  if (numM) return { el: node, type: 'number', prefix: numM[0],
                     num: parseInt(numM[1]),
                     isEmpty: text.slice(numM[0].length).trim() === '' };

  // 2. Alphabetic  "a. " "b. "  (single letter, a-z case-insensitive)
  const alpM = text.match(/^([a-zA-Z])\.\s/);
  if (alpM) return { el: node, type: 'alpha', prefix: alpM[0],
                     char: alpM[1].toLowerCase(),
                     isEmpty: text.slice(alpM[0].length).trim() === '' };

  // 3. Dash  "- "
  if (text.match(/^-\s/)) return { el: node, type: 'dash', prefix: '- ',
                                    isEmpty: text.slice(2).trim() === '' };

  // 4. Bullet  "• "
  if (text.match(/^•\s/)) return { el: node, type: 'bullet', prefix: '• ',
                                    isEmpty: text.slice(2).trim() === '' };
  return null;
}

/**
 * Return the prefix the *next* line should receive.
 *   number  →  increments digit       "1. " → "2. "
 *   alpha   →  advances letter        "a. " → "b. "  (stops at z)
 *   dash    →  unchanged              "- "  → "- "
 *   bullet  →  unchanged              "• "  → "• "
 */
function nextListPrefix(info) {
  switch (info.type) {
    case 'number': return `${info.num + 1}. `;
    case 'alpha': {
      const nxt = String.fromCharCode(info.char.charCodeAt(0) + 1);
      return `${nxt <= 'z' ? nxt : info.char}. `;
    }
    case 'dash':   return '- ';
    case 'bullet': return '• ';
    default:       return '';
  }
}

/** Move the caret to the very start of a block element */
function caretToStart(el) {
  el.normalize();
  const sel = window.getSelection();
  const r   = document.createRange();
  const tn  = firstTextNode(el);
  tn ? r.setStart(tn, 0) : r.setStart(el, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Empty a block element and leave it in a clean, focusable state.
 * A lone <br> is required so the empty <p> keeps its height and
 * the caret has somewhere to land in all browsers.
 */
function clearBlock(el) {
  if (el === editor) {
    // Text was a direct child of the editor (no <p> wrapper yet — first line).
    // Inject a proper empty paragraph so the caret has a real block to land in.
    editor.innerHTML = '<p><br></p>';
    caretToStart(editor.firstElementChild);
    return;
  }
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(document.createElement('br'));
  caretToStart(el);
}

/**
 * After any deletion, re-sequence every consecutive auto-list run so
 * numbering / lettering stays gapless.
 *   Numbers  →  1, 2, 3 …
 *   Letters  →  a, b, c …
 *   Dash / bullet items are all identical, so no resequencing needed.
 * Caret is saved and restored around DOM mutations.
 */
function resequenceLists() {
  const sel = window.getSelection();
  let anc = null, ancOff = 0;
  if (sel && sel.rangeCount) { anc = sel.anchorNode; ancOff = sel.anchorOffset; }

  let runType    = null;  // 'number' | 'alpha' | null
  let runCounter = 0;     // number: 1,2,3…   alpha: 0,1,2… (0 = 'a')

  Array.from(editor.childNodes).forEach(n => {
    // Skip invisible nodes — don't let them reset a running sequence
    if (n.nodeType === Node.TEXT_NODE && !n.textContent.trim()) return;
    if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR') return;
    if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.TEXT_NODE) return;

    const t    = n.textContent;
    const numM = t.match(/^(\d+)\.\s/);
    const alpM = t.match(/^([a-zA-Z])\.\s/);

    if (numM) {
      if (runType !== 'number') { runType = 'number'; runCounter = 1; }
      const actual = parseInt(numM[1]);
      if (actual !== runCounter) {
        const tn = firstTextNode(n);
        if (tn && /^\d+\./.test(tn.nodeValue))
          tn.nodeValue = tn.nodeValue.replace(/^\d+/, String(runCounter));
      }
      runCounter++;
    } else if (alpM) {
      if (runType !== 'alpha') { runType = 'alpha'; runCounter = 0; }
      const actual = alpM[1].toLowerCase().charCodeAt(0) - 97;
      if (actual !== runCounter) {
        const expected = String.fromCharCode(97 + runCounter);
        const tn = firstTextNode(n);
        if (tn && /^[a-zA-Z]\./.test(tn.nodeValue))
          tn.nodeValue = tn.nodeValue.replace(/^[a-zA-Z]/, expected);
      }
      runCounter++;
    } else {
      runType = null; runCounter = 0;  // any other content breaks the run
    }
  });

  // Restore caret
  if (anc) {
    try {
      const r = document.createRange();
      r.setStart(anc, Math.min(ancOff, anc.length ?? 0));
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    } catch { /* anchor gone – ignore */ }
  }
}

/* ── keydown: handle Enter, Backspace, and the double-Space exit ── */
editor.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) return; // never intercept shortcut keys

  const info = listLineInfo(); // null when not on a list line

  /* ── ENTER ────────────────────────────────── */
  if (e.key === 'Enter') {
    if (!info) return; // normal Enter for non-list lines
    e.preventDefault();

    if (info.isEmpty) {
      /* Bare "N. " line → user wants out of the list */
      clearBlock(info.el);
    } else {
      /* Line has content → continue list with next number.
         When the cursor is still in a bare text node (first line, no <p> yet),
         browsers may produce  "text + <br> + <p>"  after insertParagraph.
         Explicitly wrapping the loose content first guarantees a clean
         "<p>1. …</p><p>2. …</p>" structure that renumberLists can scan. */
      if (info.el === editor) {
        const p = document.createElement('p');
        // Move every loose child (text nodes + lone BRs) into the new <p>
        Array.from(editor.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE ||
                       (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR'))
          .forEach(n => p.appendChild(n));
        editor.insertBefore(p, editor.firstElementChild || null);
        // Place caret at the end of the freshly-wrapped text
        const r0 = document.createRange();
        r0.selectNodeContents(p); r0.collapse(false);
        const s0 = window.getSelection(); s0.removeAllRanges(); s0.addRange(r0);
      }
      document.execCommand('insertParagraph', false, null);
      document.execCommand('insertText',      false, nextListPrefix(info));
    }
    updateStats(); scheduleSave();
    return;
  }

  /* ── BACKSPACE ─────────────────────────────── */
  if (e.key === 'Backspace') {
    if (!info) return;
    // Only intercept when caret sits right at the end of the prefix
    // e.g. "2. |" (cursor directly after the space following the dot)
    const offset = caretOffsetInBlock(info.el);
    if (offset !== info.prefix.length) return;

    e.preventDefault();
    const tn = firstTextNode(info.el);
    if (tn) {
      // Slice off "N. " from the start, keep any following text
      tn.nodeValue = tn.nodeValue.slice(info.prefix.length);
    } else {
      clearBlock(info.el);
    }
    caretToStart(info.el);
    setTimeout(resequenceLists, 0); // let DOM settle first
    updateStats(); scheduleSave();
    return;
  }

  /* ── SPACE (second space cancels the bare prefix) ───────────── */
  if (e.key === ' ' && info && info.isEmpty) {
    /* "N. " + another Space → remove the number, leave blank line */
    e.preventDefault();
    clearBlock(info.el);
    updateStats(); scheduleSave();
  }
});

/* ── input: renumber after paste, drag-drop, or keyboard delete ── */
editor.addEventListener('input', e => {
  // inputType is undefined in some mobile browsers, so guard for it
  const t = e.inputType || '';
  if (t.startsWith('delete') || t === 'deleteByCut') {
    setTimeout(resequenceLists, 0);
  }
});

/* Toolbar buttons */
document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => {
    e.preventDefault();
    execFmt(btn.dataset.cmd);
    setTimeout(syncToolbar, 40);
    setTimeout(() => { updateStats(); scheduleSave(); }, 80);
  });
});

/* Export */
$('btnExp').addEventListener('click', e => {
  e.stopPropagation();
  $('expMenu').classList.toggle('open');
});
document.addEventListener('click', () => $('expMenu').classList.remove('open'));
$('expMenu').addEventListener('click', e => {
  const item = e.target.closest('.exp-item');
  if (!item) return;
  $('expMenu').classList.remove('open');
  exportNote(item.dataset.fmt);
});

/* Delete */
let pendingDel = null;
function showDelModal(id) {
  pendingDel = id;
  const linked = tasks.filter(t => t.sourceNoteId === id);
  const desc   = $('delModal').querySelector('.modal-desc');
  if (linked.length) {
    desc.innerHTML = `This note has <strong>${linked.length} linked task${linked.length > 1 ? 's' : ''}</strong>. The task${linked.length > 1 ? 's' : ''} will remain but lose their note link. This action cannot be undone.`;
  } else {
    desc.textContent = 'This action cannot be undone. The note will be permanently removed from your device.';
  }
  $('delModal').classList.add('open');
}
$('btnDel').addEventListener('click', () => { if (cur) showDelModal(cur); });
$('cancelDel').addEventListener('click', () => { $('delModal').classList.remove('open'); pendingDel = null; });
$('confirmDel').addEventListener('click', () => {
  if (pendingDel) { deleteNote(pendingDel); $('delModal').classList.remove('open'); pendingDel = null; }
});

/* Import */
$('btnImportSb').addEventListener('click', () => $('impModal').classList.add('open'));
$('cancelImp').addEventListener('click',   () => $('impModal').classList.remove('open'));

const dropZone = $('dropZone');
const fileInp  = $('fileInp');

dropZone.addEventListener('click', () => fileInp.click());
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) { $('impModal').classList.remove('open'); importFile(f); }
});
fileInp.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) { $('impModal').classList.remove('open'); importFile(f); }
  fileInp.value = '';
});

/* Close modals on overlay click */
document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
});

/* ═══════════════════════════════
   CALCULATOR
═══════════════════════════════ */
let cIn       = '';    // number being typed
let cTokens   = [];    // ["3", "+", "4", "-", …] alternating numbers / operators
let cDone     = false; // true right after = was pressed
let cFullExpr = '';    // e.g. "3 + 4 = 7"  (set on =, cleared when new digit typed)

const C_OPS = { '+':'+', '-':'−', '*':'×', '/':'÷' };

function calcKey(k) {

  /* ── Clear ── */
  if (k === 'C') {
    cIn = ''; cTokens = []; cDone = false; cFullExpr = '';
    calcRefresh('0', ''); return;
  }

  /* ── Backspace ── */
  if (k === 'backspace') {
    if (cDone) { calcKey('C'); return; }
    if (cIn) {
      cIn = cIn.slice(0, -1);
    } else if (cTokens.length >= 2) {
      cTokens.splice(-1, 1);               // remove operator
      cIn = cTokens.splice(-1, 1)[0] || ''; // restore previous number
    }
    calcRefresh(cIn || '0', null); return;
  }

  /* ── Percent ── */
  if (k === '%') {
    const n = parseFloat(cIn || '0') / 100;
    cIn = '' + +n.toFixed(10);
    calcRefresh(cIn, null); return;
  }

  /* ── Operator ── */
  if (['+', '-', '*', '/'].includes(k)) {
    if (cDone) cDone = false;
    if (cIn || cTokens.length === 0) {
      cTokens.push(cIn || '0');
      cTokens.push(k);
      cIn = '';
    } else if (cTokens.length) {
      cTokens[cTokens.length - 1] = k; // replace last operator
    }
    calcRefresh(C_OPS[k], tokDisp()); return;
  }

  /* ── Equals ── */
  if (k === '=') {
    const lastNum = cIn || (cTokens.length >= 2 ? cTokens[cTokens.length - 2] : '0');
    const allTok  = [...cTokens, lastNum];
    if (allTok.length === 1) {
      cFullExpr = allTok[0];
      cIn = allTok[0]; cTokens = []; cDone = true;
      calcRefresh(allTok[0], allTok[0] + ' ='); return;
    }
    const evalStr = allTok.join('');
    const dispStr = tokDisp(allTok);
    try {
      if (!/^[\d+\-*/.]+$/.test(evalStr)) throw new Error();
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict";return(' + evalStr + ')')();
      if (!isFinite(result)) throw new Error();
      const res = '' + +result.toFixed(10);
      cFullExpr = dispStr + ' = ' + res;
      cDone = true; cIn = res; cTokens = [];
      calcRefresh(res, dispStr + ' =');
    } catch {
      calcRefresh('Error', dispStr + ' =');
      cIn = ''; cTokens = []; cDone = false;
    }
    return;
  }

  /* ── Decimal ── */
  if (k === '.') {
    if (cDone) { cIn = '0'; cTokens = []; cDone = false; cFullExpr = ''; }
    if (!cIn.includes('.')) cIn = (cIn || '0') + '.';
    calcRefresh(cIn, null); return;
  }

  /* ── Digit ── */
  if ('0123456789'.includes(k)) {
    if (cDone) { cIn = ''; cTokens = []; cDone = false; cFullExpr = ''; }
    if (cIn.length >= 15) return;
    cIn = cIn === '0' ? k : cIn + k;
    calcRefresh(cIn, null);
  }
}

/* Build a human-readable expression from the tokens array */
function tokDisp(toks) {
  const t = toks || cTokens;
  return t.map((v, i) => i % 2 === 0 ? v : (' ' + C_OPS[v] + ' ')).join('');
}

/* Update display; pass null to leave that line unchanged */
function calcRefresh(val, expr) {
  if (val  !== null) $('calcVal').textContent  = val;
  if (expr !== null) $('calcExpr').textContent = expr;
}

/* Insert into the active note */
function calcInsert(mode) {
  if (!cur) { toast('Open a note first to insert', 'err'); return; }
  const val = $('calcVal').textContent;
  if (!val || val === 'Error') { toast('Nothing to insert', 'err'); return; }
  let text;
  if (mode === 'result') {
    text = val;
  } else {
    if (cDone) {
      /* = was pressed — join the top display ("3 + 4 =") with the result ("7") */
      const exprLine = $('calcExpr').textContent.trimEnd(); // e.g. "3 + 4 ="
      text = exprLine + ' ' + val;                          // "3 + 4 = 7"
    } else {
      /* Mid-expression, no = yet — insert what's built so far */
      const partial = (tokDisp() + cIn).trim();
      text = partial || val;
    }
  }
  editor.focus();
  document.execCommand('insertText', false, text);
  updateStats();
  scheduleSave();
  toast('Inserted: ' + text, 'ok');
}

/* Open / close the panel anchored below the toolbar button */
function toggleCalc() {
  const panel = $('calcPanel');
  const btn   = $('btnCalc');
  if (panel.classList.contains('calc-open')) {
    panel.classList.remove('calc-open');
    btn.classList.remove('on');
    return;
  }
  // Close calendar and table panels if open
  $('calPanel').classList.remove('cal-open');
  $('btnCal').classList.remove('on');
  $('tblPanel').classList.remove('tbl-open');
  $('btnTbl').classList.remove('on');
  const rect = btn.getBoundingClientRect();
  const pw   = 216;
  let   left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  panel.style.left = Math.max(8, left) + 'px';
  panel.style.top  = (rect.bottom + 6) + 'px';
  panel.classList.add('calc-open');
  btn.classList.add('on');
}

/* ── Calculator events ── */
$('btnCalc').addEventListener('click',  e => { e.stopPropagation(); toggleCalc(); });
$('calcClose').addEventListener('click', () => {
  $('calcPanel').classList.remove('calc-open');
  $('btnCalc').classList.remove('on');
});
$('calcPanel').querySelector('.calc-grid').addEventListener('click', e => {
  const btn = e.target.closest('[data-ck]');
  if (btn) calcKey(btn.dataset.ck);
});
$('ciExpr').addEventListener('click', () => calcInsert('expr'));
$('ciRes').addEventListener('click',  () => calcInsert('result'));

/* Close calc when clicking outside */
document.addEventListener('click', e => {
  if (!e.target.closest('#calcPanel') && !e.target.closest('#btnCalc')) {
    $('calcPanel').classList.remove('calc-open');
    $('btnCalc').classList.remove('on');
  }
});

/* ═══════════════════════════════
   CALENDAR
═══════════════════════════════ */
let calYear   = new Date().getFullYear();
let calMonth  = new Date().getMonth(); // 0-11
let calPicked = null;                  // selected Date object

const CAL_MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

function renderCal() {
  const today  = new Date();
  const first  = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
  const days   = new Date(calYear, calMonth + 1, 0).getDate();
  const offset = first === 0 ? 6 : first - 1; // shift to Monday-first

  $('calMonthSel').value = calMonth;
  $('calYearSel').value  = calYear;

  let html = '';
  for (let i = 0; i < offset; i++) html += '<span class="cal-empty"></span>';
  for (let d = 1; d <= days; d++) {
    const dow     = (offset + d - 1) % 7; // 0=Mon … 5=Sat, 6=Sun
    const isToday = today.getDate()===d && today.getMonth()===calMonth && today.getFullYear()===calYear;
    const isSel   = calPicked && calPicked.getDate()===d && calPicked.getMonth()===calMonth && calPicked.getFullYear()===calYear;
    const isWknd  = dow === 5 || dow === 6;
    const cls = ['cal-day',
      isToday ? 'cal-today' : '',
      isSel   ? 'cal-sel'   : '',
      (isWknd && !isSel) ? 'cal-wknd' : ''
    ].filter(Boolean).join(' ');
    html += `<button class="${cls}" data-d="${d}">${d}</button>`;
  }
  $('calGrid').innerHTML = html;

  const disp = $('calSelDisp');
  if (calPicked) {
    disp.textContent = calPicked.toLocaleDateString('en-US',
      { weekday:'short', month:'short', day:'numeric', year:'numeric' });
    disp.style.color = 'var(--txt)';
  } else {
    disp.textContent = 'No date selected';
    disp.style.color = '';
  }
}

function calInsert(mode) {
  if (!cur)       { toast('Open a note first', 'err'); return; }
  if (!calPicked) { toast('Select a date first', 'err'); return; }
  const text = mode === 'short'
    ? calPicked.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
    : calPicked.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  editor.focus();
  document.execCommand('insertText', false, text);
  updateStats();
  scheduleSave();
  toast('Inserted: ' + text, 'ok');
}

function toggleCal() {
  const panel = $('calPanel');
  const btn   = $('btnCal');
  if (panel.classList.contains('cal-open')) {
    panel.classList.remove('cal-open');
    btn.classList.remove('on'); return;
  }
  // Close calculator and table panels if open
  $('calcPanel').classList.remove('calc-open');
  $('btnCalc').classList.remove('on');
  $('tblPanel').classList.remove('tbl-open');
  $('btnTbl').classList.remove('on');
  const rect = btn.getBoundingClientRect();
  const pw   = 248;
  let   left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  panel.style.left = Math.max(8, left) + 'px';
  panel.style.top  = (rect.bottom + 6) + 'px';
  panel.classList.add('cal-open');
  btn.classList.add('on');
  renderCal();
}

/* ── Calendar events ── */
$('btnCal').addEventListener('click',  e => { e.stopPropagation(); toggleCal(); });
$('calClose').addEventListener('click', () => { $('calPanel').classList.remove('cal-open'); $('btnCal').classList.remove('on'); });
$('calPrev').addEventListener('click',  () => { if (--calMonth < 0)  { calMonth = 11; calYear--; } renderCal(); });
$('calNext').addEventListener('click',  () => { if (++calMonth > 11) { calMonth = 0;  calYear++; } renderCal(); });
$('calToday').addEventListener('click', () => { const t = new Date(); calYear = t.getFullYear(); calMonth = t.getMonth(); renderCal(); });
$('calGrid').addEventListener('click', e => {
  const d = e.target.closest('[data-d]');
  if (!d) return;
  e.stopPropagation();
  calPicked = new Date(calYear, calMonth, +d.dataset.d);
  renderCal();
});
$('calInsShort').addEventListener('click', () => calInsert('short'));
$('calInsFull').addEventListener('click',  () => calInsert('full'));

/* Populate year select (current year −50 → +20) and wire both selects */
(function() {
  const ySel   = $('calYearSel');
  const thisYr = new Date().getFullYear();
  for (let y = thisYr - 50; y <= thisYr + 20; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y; ySel.appendChild(o);
  }
  ySel.value = calYear;
})();
$('calMonthSel').addEventListener('change', () => { calMonth = +$('calMonthSel').value; renderCal(); });
$('calYearSel').addEventListener('change',  () => { calYear  = +$('calYearSel').value;  renderCal(); });

/* Close calendar when clicking outside */
document.addEventListener('click', e => {
  if (!e.target.closest('#calPanel') && !e.target.closest('#btnCal')) {
    $('calPanel').classList.remove('cal-open');
    $('btnCal').classList.remove('on');
  }
});

/* Global keyboard shortcuts */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
    $('expMenu').classList.remove('open');
    toggleSidebar(false);
    $('calcPanel').classList.remove('calc-open');
    $('btnCalc').classList.remove('on');
    $('calPanel').classList.remove('cal-open');
    $('btnCal').classList.remove('on');
    $('tblPanel').classList.remove('tbl-open');
    $('btnTbl').classList.remove('on');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n' && document.activeElement !== editor) {
    e.preventDefault(); createNote();
  }
});

/* ═══════════════════════════════
   TABLE TOOL
═══════════════════════════════ */
(function buildTblGrid() {
  const grid = $('tblGrid');
  for (let r = 1; r <= 8; r++) {
    for (let c = 1; c <= 8; c++) {
      const el = document.createElement('div');
      el.className = 'tg-cell';
      el.dataset.r = r; el.dataset.c = c;
      grid.appendChild(el);
    }
  }
})();

$('tblGrid').addEventListener('mouseover', e => {
  const cell = e.target.closest('.tg-cell');
  if (!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  $('tblLabel').textContent = `${r} row${r>1?'s':''} × ${c} col${c>1?'s':''}`;
  $('tblRows').value = r; $('tblCols').value = c;
  $('tblGrid').querySelectorAll('.tg-cell').forEach(ce =>
    ce.classList.toggle('tg-hi', +ce.dataset.r <= r && +ce.dataset.c <= c));
});
$('tblGrid').addEventListener('mouseleave', () => {
  $('tblGrid').querySelectorAll('.tg-cell').forEach(ce => ce.classList.remove('tg-hi'));
  $('tblLabel').textContent = 'Hover to select size';
});
$('tblGrid').addEventListener('click', e => {
  if (e.target.closest('.tg-cell')) { e.stopPropagation(); doInsertTable(); }
});
$('tblInsert').addEventListener('click', doInsertTable);
$('tblClose').addEventListener('click', () => {
  $('tblPanel').classList.remove('tbl-open');
  $('btnTbl').classList.remove('on');
});

function doInsertTable() {
  if (!cur) { toast('Open a note first', 'err'); return; }
  // Defaults — every new table starts identical for a consistent look.
  const DEFAULT_ROWS = 3, DEFAULT_COLS = 3;
  const DEFAULT_COLW = 110, DEFAULT_ROWH = 32;

  // Allow user overrides from the panel inputs but fall back to defaults.
  const rows = Math.max(1, parseInt($('tblRows').value) || DEFAULT_ROWS);
  const cols = Math.max(1, parseInt($('tblCols').value) || DEFAULT_COLS);
  const rowH = Math.max(20, parseInt($('tblRowH').value) || DEFAULT_ROWH);
  const colW = Math.max(40, parseInt($('tblColW').value) || DEFAULT_COLW);

  const tdBase =
    `border:1px solid #3a3221;padding:5px 8px;` +
    `width:${colW}px;min-width:${colW}px;max-width:${colW}px;` +
    `height:${rowH}px;` +
    `word-break:break-word;vertical-align:top;white-space:normal;`;

  let tRows = '';
  for (let r = 0; r < rows; r++) {
    tRows += '<tr>';
    for (let c = 0; c < cols; c++) {
      const hdr = r === 0 ? 'background:#29241a;font-weight:500;' : '';
      tRows += `<td contenteditable="true" style="${tdBase}${hdr}"><br></td>`;
    }
    tRows += '</tr>';
  }

  const html =
    `<br><div class="ptb" contenteditable="false" data-colw="${colW}" data-rowh="${rowH}" style="transform:translate(0px,0px)">` +
      `<div class="ptb-inner">` +
        `<div class="ptb-bar">` +
          `<span class="ptb-hint">⠿ Drag to move</span>` +
          `<button class="ptb-x" title="Remove table">×</button>` +
        `</div>` +
        `<div class="ptb-tbl-wrap">` +
          `<table style="border-collapse:collapse;table-layout:fixed;margin:0"><tbody>${tRows}</tbody></table>` +
        `</div>` +
        `<div class="ptb-rcol">` +
          `<button class="ptb-btn ptb-col-add" title="Add column">+</button>` +
          `<div class="ptb-rgrip ptb-col-grip" title="Drag to resize columns"></div>` +
          `<button class="ptb-btn ptb-col-rem" title="Remove last column">−</button>` +
        `</div>` +
        `<div class="ptb-rrow">` +
          `<button class="ptb-btn ptb-row-add" title="Add row">+</button>` +
          `<div class="ptb-rgrip ptb-row-grip" title="Drag to resize rows"></div>` +
          `<button class="ptb-btn ptb-row-rem" title="Remove last row">−</button>` +
        `</div>` +
        `<div class="ptb-corner" title="Drag to resize table"></div>` +
      `</div>` +
    `</div><br>`;

  editor.focus();
  document.execCommand('insertHTML', false, html);
  updateStats(); scheduleSave();
  $('tblPanel').classList.remove('tbl-open');
  $('btnTbl').classList.remove('on');
  toast(`${rows}×${cols} table inserted`, 'ok');
}

/* ── Table interactions: delete · add/remove rows+cols · resize · drag-to-move ──
   All handlers support both mouse and touch events. Position, row count,
   column count, row height and column width all live in the DOM as inline
   styles / dataset attributes, so saving editor.innerHTML persists them. */

const PTB_LIMITS = { colMin: 40, colMax: 480, rowMin: 20, rowMax: 240 };

/* Pointer helpers (mouse + touch unified) */
function ptbPoint(ev) {
  if (ev.touches && ev.touches[0]) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
  if (ev.changedTouches && ev.changedTouches[0]) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
  return { x: ev.clientX, y: ev.clientY };
}
function ptbBindMove(onMove, onUp) {
  const move = ev => { onMove(ev); if (ev.cancelable) ev.preventDefault(); };
  const up   = ev => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
    document.removeEventListener('touchcancel', up);
    onUp(ev);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend', up);
  document.addEventListener('touchcancel', up);
}

/* Click handlers — delete · add/remove rows · add/remove cols */
editor.addEventListener('click', e => {
  const wrap = e.target.closest('.ptb');
  if (!wrap) return;
  if (e.target.closest('.ptb-x'))       { wrap.remove(); updateStats(); scheduleSave(); return; }
  const tbl = wrap.querySelector('table');
  if (e.target.closest('.ptb-row-add')) { ptbAddRow(tbl); scheduleSave(); }
  else if (e.target.closest('.ptb-row-rem')) { ptbRemoveRow(tbl); scheduleSave(); }
  else if (e.target.closest('.ptb-col-add')) { ptbAddCol(tbl); scheduleSave(); }
  else if (e.target.closest('.ptb-col-rem')) { ptbRemoveCol(tbl); scheduleSave(); }
  updateStats();
});

function ptbCurrentColW(wrap) { return parseInt(wrap.dataset.colw) || 110; }
function ptbCurrentRowH(wrap) { return parseInt(wrap.dataset.rowh) || 32; }

function ptbApplyAllCols(wrap, w) {
  wrap.dataset.colw = w;
  wrap.querySelectorAll('table td').forEach(td => {
    td.style.width = w + 'px';
    td.style.minWidth = w + 'px';
    td.style.maxWidth = w + 'px';
  });
}
function ptbApplyAllRows(wrap, h) {
  wrap.dataset.rowh = h;
  wrap.querySelectorAll('table td').forEach(td => { td.style.height = h + 'px'; });
}

function ptbAddRow(tbl) {
  const wrap = tbl.closest('.ptb');
  const w = ptbCurrentColW(wrap), h = ptbCurrentRowH(wrap);
  const tr = document.createElement('tr');
  const cols = tbl.querySelector('tr').children.length;
  for (let c = 0; c < cols; c++) {
    const td = document.createElement('td');
    td.contentEditable = 'true';
    td.style.cssText = `border:1px solid #3a3221;padding:5px 8px;width:${w}px;min-width:${w}px;max-width:${w}px;height:${h}px;word-break:break-word;vertical-align:top;white-space:normal;`;
    td.innerHTML = '<br>';
    tr.appendChild(td);
  }
  tbl.querySelector('tbody').appendChild(tr);
}
function ptbRemoveRow(tbl) {
  const rows = tbl.querySelectorAll('tr');
  if (rows.length <= 1) return;
  rows[rows.length - 1].remove();
}
function ptbAddCol(tbl) {
  const wrap = tbl.closest('.ptb');
  const w = ptbCurrentColW(wrap), h = ptbCurrentRowH(wrap);
  tbl.querySelectorAll('tr').forEach((row, i) => {
    const td = document.createElement('td');
    td.contentEditable = 'true';
    const hdr = i === 0 ? 'background:#29241a;font-weight:500;' : '';
    td.style.cssText = `border:1px solid #3a3221;padding:5px 8px;width:${w}px;min-width:${w}px;max-width:${w}px;height:${h}px;word-break:break-word;vertical-align:top;white-space:normal;${hdr}`;
    td.innerHTML = '<br>';
    row.appendChild(td);
  });
}
function ptbRemoveCol(tbl) {
  const firstRow = tbl.querySelector('tr');
  if (firstRow.children.length <= 1) return;
  tbl.querySelectorAll('tr').forEach(row => row.lastElementChild && row.lastElementChild.remove());
}

/* Pointer-down dispatcher — drag (header), row-resize, col-resize, free corner-resize */
function ptbStart(e) {
  const wrap = e.target.closest('.ptb');
  if (!wrap) return;

  // Header drag (avoid the close × button)
  const bar = e.target.closest('.ptb-bar');
  if (bar && !e.target.closest('.ptb-x')) { e.preventDefault(); ptbDrag(e, wrap, bar); return; }

  if (e.target.closest('.ptb-btn')) return; // let click fire

  if (e.target.closest('.ptb-row-grip')) { e.preventDefault(); ptbResizeRows(e, wrap, e.target.closest('.ptb-row-grip')); return; }
  if (e.target.closest('.ptb-col-grip')) { e.preventDefault(); ptbResizeCols(e, wrap, e.target.closest('.ptb-col-grip')); return; }
  if (e.target.closest('.ptb-corner'))   { e.preventDefault(); ptbResizeCorner(e, wrap, e.target.closest('.ptb-corner')); return; }
}
editor.addEventListener('mousedown', ptbStart);
editor.addEventListener('touchstart', ptbStart, { passive: false });

/* Touch/click reveal: show controls on the touched table, hide others */
function ptbReveal(e) {
  const wrap = e.target.closest('.ptb');
  document.querySelectorAll('.ptb.ptb-show').forEach(el => { if (el !== wrap) el.classList.remove('ptb-show'); });
  if (wrap) wrap.classList.add('ptb-show');
}
document.addEventListener('touchstart', ptbReveal, { passive: true });
document.addEventListener('mousedown', ptbReveal);

/* Drag-to-move: store translate offset on inline style so it persists with HTML save */
function ptbDrag(e, wrap, bar) {
  const start = ptbPoint(e);
  const m = (wrap.style.transform || '').match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/);
  const x0 = m ? parseFloat(m[1]) : 0;
  const y0 = m ? parseFloat(m[2]) : 0;
  let moved = false;
  bar.classList.add('ptb-bar-active');

  ptbBindMove(ev => {
    const p = ptbPoint(ev);
    const dx = p.x - start.x, dy = p.y - start.y;
    if (!moved && Math.hypot(dx, dy) > 4) { moved = true; wrap.classList.add('ptb-dragging'); }
    if (moved) wrap.style.transform = `translate(${x0 + dx}px, ${y0 + dy}px)`;
  }, () => {
    wrap.classList.remove('ptb-dragging');
    bar.classList.remove('ptb-bar-active');
    if (moved) { updateStats(); scheduleSave(); }
  });
}

/* Row-resize: drag up = smaller, drag down = bigger; uniform across all rows */
function ptbResizeRows(e, wrap, grip) {
  const start = ptbPoint(e);
  const startH = ptbCurrentRowH(wrap);
  grip.classList.add('ptb-active');
  wrap.classList.add('ptb-resizing');
  ptbBindMove(ev => {
    const dy = ptbPoint(ev).y - start.y;
    const h = Math.max(PTB_LIMITS.rowMin, Math.min(PTB_LIMITS.rowMax, startH + dy));
    ptbApplyAllRows(wrap, Math.round(h));
  }, () => {
    grip.classList.remove('ptb-active');
    wrap.classList.remove('ptb-resizing');
    updateStats(); scheduleSave();
  });
}

function ptbResizeCols(e, wrap, grip) {
  const start = ptbPoint(e);
  const startW = ptbCurrentColW(wrap);
  grip.classList.add('ptb-active');
  wrap.classList.add('ptb-resizing');
  ptbBindMove(ev => {
    const dx = ptbPoint(ev).x - start.x;
    const w = Math.max(PTB_LIMITS.colMin, Math.min(PTB_LIMITS.colMax, startW + dx));
    ptbApplyAllCols(wrap, Math.round(w));
  }, () => {
    grip.classList.remove('ptb-active');
    wrap.classList.remove('ptb-resizing');
    updateStats(); scheduleSave();
  });
}

/* Corner free-resize: scales rows + columns proportionally based on
   the larger of horizontal / vertical drag distance. */
function ptbResizeCorner(e, wrap, corner) {
  const start = ptbPoint(e);
  const startW = ptbCurrentColW(wrap);
  const startH = ptbCurrentRowH(wrap);
  corner.classList.add('ptb-active');
  wrap.classList.add('ptb-resizing');
  ptbBindMove(ev => {
    const p = ptbPoint(ev);
    const dx = p.x - start.x, dy = p.y - start.y;
    // Average horizontal & vertical drag → uniform scaling factor
    const scale = 1 + ((dx / (startW * 3)) + (dy / (startH * 6))) / 2 * 2;
    const w = Math.max(PTB_LIMITS.colMin, Math.min(PTB_LIMITS.colMax, Math.round(startW * scale)));
    const h = Math.max(PTB_LIMITS.rowMin, Math.min(PTB_LIMITS.rowMax, Math.round(startH * scale)));
    ptbApplyAllCols(wrap, w);
    ptbApplyAllRows(wrap, h);
  }, () => {
    corner.classList.remove('ptb-active');
    wrap.classList.remove('ptb-resizing');
    updateStats(); scheduleSave();
  });
}

function toggleTbl() {
  const panel = $('tblPanel'), btn = $('btnTbl');
  if (panel.classList.contains('tbl-open')) {
    panel.classList.remove('tbl-open'); btn.classList.remove('on'); return;
  }
  $('calcPanel').classList.remove('calc-open'); $('btnCalc').classList.remove('on');
  $('calPanel').classList.remove('cal-open');   $('btnCal').classList.remove('on');
  const rect = btn.getBoundingClientRect();
  const pw   = 264;
  let   left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  panel.style.left = Math.max(8, left) + 'px';
  panel.style.top  = (rect.bottom + 6) + 'px';
  panel.classList.add('tbl-open'); btn.classList.add('on');
}

$('btnTbl').addEventListener('click', e => { e.stopPropagation(); toggleTbl(); });
document.addEventListener('click', e => {
  if (!e.target.closest('#tblPanel') && !e.target.closest('#btnTbl')) {
    $('tblPanel').classList.remove('tbl-open');
    $('btnTbl').classList.remove('on');
  }
});

/* ═══════════════════════════════
   WELCOME SEARCH
═══════════════════════════════ */
$('wsInp').addEventListener('input', () => {
  const q   = $('wsInp').value.toLowerCase().trim();
  const box = $('wsResults');
  if (!q) { box.innerHTML = ''; return; }
  const hits = notes.filter(n =>
    noteTitle(n).toLowerCase().includes(q) ||
    plain(n.content).toLowerCase().includes(q)
  ).slice(0, 7);
  if (!hits.length) {
    box.innerHTML = '<div class="ws-empty">No notes found</div>'; return;
  }
  box.innerHTML = hits.map(n => `
    <div class="ws-item" data-id="${n.id}">
      <div class="ws-item-title">${esc(noteTitle(n))}</div>
      <div class="ws-item-prev">${esc(plain(n.content).slice(0,70))}</div>
    </div>`).join('');
});
$('wsResults').addEventListener('click', e => {
  const item = e.target.closest('[data-id]');
  if (item) { $('wsInp').value = ''; $('wsResults').innerHTML = ''; openNote(item.dataset.id); }
});

/* Sidebar search button → focus the existing search input */
$('btnSbSearch').addEventListener('click', () => { searchInp.focus(); searchInp.select(); });

/* ═══════════════════════════════════════════════════════
   TODO & MAP SYSTEM
═══════════════════════════════════════════════════════ */
const TASKS_KEY = 'pencraft_tasks_v1';
const MAPS_KEY  = 'pencraft_maps_v1';

let tasks        = [];
let maps         = [];
let todoSortMode = 'due';
let todoView     = 'list';
let todoCalYear  = new Date().getFullYear();
let todoCalMonth = new Date().getMonth();
let todoCalSel   = null;
let curMapId     = null;
let ctxSelText   = null;
let ctxSelItems  = null;

/* ── Storage ── */
function loadTasks() { try { tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch { tasks = []; } }
function persistTasks() { try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); } catch {} }
function loadMaps()  { try { maps  = JSON.parse(localStorage.getItem(MAPS_KEY)  || '[]'); } catch { maps  = []; } }
function persistMaps()  { try { localStorage.setItem(MAPS_KEY,  JSON.stringify(maps));  } catch {} }

/* ── Task helpers ── */
function getTask(id)    { return tasks.find(t => t.id === id); }
function getMapById(id) { return maps.find(m => m.id === id); }

function createTask(data) {
  const t = {
    id: uid(), title: data.title || 'Untitled task',
    sourceNoteId: data.sourceNoteId || null, sourceNoteTitle: data.sourceNoteTitle || '',
    mapId: data.mapId || null, priority: data.priority || 'normal',
    dueDate: data.dueDate || '', dueTime: data.dueTime || '',
    complete: false, created: Date.now()
  };
  tasks.push(t); persistTasks(); updateTodoBadge(); return t;
}
function deleteTask(id) { tasks = tasks.filter(t => t.id !== id); persistTasks(); updateTodoBadge(); }
function toggleTask(id) {
  const t = getTask(id); if (!t) return;
  t.complete = !t.complete;
  if (t.mapId) {
    const m = getMapById(t.mapId);
    if (m) {
      const ap = m.actionPlan.find(a => a.text === t.title);
      if (ap) {
        ap.done = t.complete; persistMaps();
        // Keep MAP detail view in sync if it's currently showing this MAP
        if (curMapId === m.id && $('mapDetailView') && $('mapDetailView').style.display !== 'none') {
          const cb = document.querySelector(`[data-apdone="${ap.id}"]`);
          if (cb) {
            cb.classList.toggle('checked', ap.done);
            cb.innerHTML = ap.done ? '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : '';
            const inp = cb.closest('.ap-item') && cb.closest('.ap-item').querySelector('.ap-text');
            if (inp) inp.classList.toggle('done-text', ap.done);
          }
          const pct = mapProgress(m), st = mapStatus(m);
          if ($('mdProgressPct')) { $('mdProgressPct').textContent = pct + '%'; $('mdProgressBar').style.width = pct + '%'; }
          if ($('mdStatusTxt')) { $('mdStatusTxt').textContent = st; $('mdStatusTxt').className = 'mt-status-display ' + statusCls(st); }
        }
      }
    }
  }
  persistTasks(); updateTodoBadge();
}
function updateTaskPriority(id, p) { const t = getTask(id); if (t) { t.priority = p; persistTasks(); } }

/* ── MAP helpers ── */
function createNewMap() {
  const m = { id: uid(), title: '', vision: '', mission: '', actionPlan: [], deadline: '', addToTodo: true, created: Date.now(), modified: Date.now() };
  maps.push(m); persistMaps(); updateMapBadge(); return m;
}
function deleteMapById(id) {
  maps = maps.filter(m => m.id !== id);
  tasks.forEach(t => { if (t.mapId === id) t.mapId = null; });
  persistTasks(); persistMaps(); updateMapBadge();
}
function mapProgress(m) {
  if (!m.actionPlan || !m.actionPlan.length) return 0;
  return Math.round(m.actionPlan.filter(a => a.done).length / m.actionPlan.length * 100);
}
function mapStatus(m) {
  const pct = mapProgress(m);
  if (pct === 100) return 'Achieved';
  if (m.deadline) { const dl = new Date(m.deadline); if (!isNaN(dl) && dl < new Date() && pct < 100) return 'Overdue'; }
  return pct === 0 ? 'Not Started' : 'In Progress';
}
function mapTitle(m) {
  if (m.title && m.title.trim()) return m.title.trim();
  if (m.vision && m.vision.trim()) return m.vision.trim().split('\n')[0].slice(0, 60);
  return 'Untitled MAP';
}

/* ── Badges ── */
function updateTodoBadge() {
  const b = $('todoBadge'); if (!b) return;
  const n = tasks.filter(t => !t.complete).length;
  b.textContent = n; b.style.display = n > 0 ? 'inline-flex' : 'none';
}
function updateMapBadge() {
  const b = $('mapBadge'); if (!b) return;
  b.textContent = maps.length; b.style.display = maps.length > 0 ? 'inline-flex' : 'none';
}

/* ── Sort ── */
const PRIO_ORD = { critical:0, important:1, normal:2, someday:3 };
function sortedTasks() {
  const list = tasks.slice();
  if (todoSortMode === 'due') {
    list.sort((a,b) => {
      const da = a.dueDate ? new Date(a.dueDate+(a.dueTime?'T'+a.dueTime:'')) : null;
      const db = b.dueDate ? new Date(b.dueDate+(b.dueTime?'T'+b.dueTime:'')) : null;
      if (!da && !db) return (PRIO_ORD[a.priority]||2)-(PRIO_ORD[b.priority]||2);
      if (!da) return 1; if (!db) return -1; return da-db;
    });
  } else {
    list.sort((a,b) => (PRIO_ORD[a.priority]||2)-(PRIO_ORD[b.priority]||2));
  }
  return list;
}
function fmtDue(t) {
  if (!t.dueDate) return '';
  const d = new Date(t.dueDate+(t.dueTime?'T'+t.dueTime:'T00:00'));
  let s = d.toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
  if (t.dueTime) s += ' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  return s;
}
function isOverdue(t) {
  if (!t.dueDate || t.complete) return false;
  return new Date(t.dueDate+(t.dueTime?'T'+t.dueTime:'T23:59')) < new Date();
}

const PRIO_LBL = { critical:'Critical', important:'Important', normal:'Normal', someday:'Someday' };

function linesToParas(text) {
  const t = (text || '').trim();
  if (!t) return '<p><br></p>';
  return t.split(/\r?\n/).map(l => `<p>${esc(l)}</p>`).join('');
}
function taskExportMeta(t) {
  const parts = [PRIO_LBL[t.priority] || 'Normal'];
  const due = fmtDue(t);
  if (due) parts.push('Due ' + due);
  if (t.sourceNoteTitle) parts.push('Note: ' + t.sourceNoteTitle);
  if (t.mapId) { const m = getMapById(t.mapId); if (m) parts.push('MAP: ' + mapTitle(m)); }
  return parts.join(' · ');
}
function buildTasksNoteContent() {
  const list = sortedTasks();
  const done = list.filter(t => t.complete);
  const rem  = list.filter(t => !t.complete);
  const d = new Date().toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  let html = `<p><strong>Task List</strong></p>`;
  html += `<p>Exported ${esc(d)} · ${list.length} total · ${done.length} completed · ${rem.length} remaining</p><p><br></p>`;
  if (rem.length) {
    html += `<p><strong>Remaining (${rem.length})</strong></p>`;
    rem.forEach(t => {
      const meta = taskExportMeta(t);
      html += `<p>• ${esc(meta ? `${t.title} — ${meta}` : t.title)}</p>`;
    });
    html += '<p><br></p>';
  }
  if (done.length) {
    html += `<p><strong>Completed (${done.length})</strong></p>`;
    done.forEach(t => {
      const meta = taskExportMeta(t);
      html += `<p>• ${esc(meta ? `${t.title} — ${meta}` : t.title)} ✓</p>`;
    });
  }
  return html;
}
function fmtMapDeadline(dl) {
  if (!dl) return '';
  const d = new Date(dl);
  return isNaN(d) ? esc(dl) : esc(d.toLocaleString(undefined, { dateStyle:'long', timeStyle:'short' }));
}
function buildMapNoteContent(m) {
  const title = mapTitle(m);
  const pct = mapProgress(m);
  const st  = mapStatus(m);
  let html = `<p><strong>${esc(title)}</strong></p>`;
  html += `<p>Status: ${esc(st)} · Progress: ${pct}%</p><p><br></p>`;
  html += '<p><strong>Vision</strong></p>' + linesToParas(m.vision);
  html += '<p><strong>Mission</strong></p>' + linesToParas(m.mission);
  html += '<p><strong>Action Plan</strong></p>';
  if (m.actionPlan && m.actionPlan.length) {
    m.actionPlan.forEach((ap, i) => {
      html += `<p>${i + 1}. ${esc(ap.text)}${ap.done ? ' ✓' : ''}</p>`;
    });
  } else {
    html += '<p><br></p>';
  }
  if (m.deadline) {
    html += '<p><strong>Deadline</strong></p>';
    html += `<p>${fmtMapDeadline(m.deadline)}</p>`;
  }
  return html;
}
function exportTasksToNote() {
  if (!tasks.length) { toast('No tasks to export', 'err'); return; }
  const d = new Date().toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  createNoteFromExport(`Tasks — ${d}`, buildTasksNoteContent());
}
function exportMapToNote(m) {
  if (!m) { toast('Nothing to export', 'err'); return; }
  createNoteFromExport(mapTitle(m), buildMapNoteContent(m));
}

/* ═══ TODO PANEL ═══ */
function openTodoPanel() {
  closeMapPanel();
  $('todoPanel').classList.add('panel-open');
  $('panelOverlay').classList.add('open');
  $('btnSbTodo').classList.add('active');
  if ($('btnTodo')) $('btnTodo').classList.add('on');
  renderTodoPanel();
}
function closeTodoPanel() {
  $('todoPanel').classList.remove('panel-open');
  $('btnSbTodo').classList.remove('active');
  if ($('btnTodo')) $('btnTodo').classList.remove('on');
  if (!$('mapPanel').classList.contains('panel-open')) $('panelOverlay').classList.remove('open');
}
function renderTodoPanel() {
  if (!$('todoPanel').classList.contains('panel-open')) return;
  const total = tasks.length, done = tasks.filter(t=>t.complete).length;
  $('tsTotalVal').textContent = total;
  $('tsDoneVal').textContent  = done;
  $('tsRemVal').textContent   = total - done;
  if (todoView === 'list') {
    $('todoListView').style.display = 'block';
    $('todoCalView').style.display  = 'none';
    $('todoSortBar').style.display  = 'flex';
    renderTaskList();
  } else {
    $('todoListView').style.display = 'none';
    $('todoCalView').style.display  = 'block';
    $('todoSortBar').style.display  = 'none';
    renderTodoCal();
  }
}
function renderTaskList() {
  const body = $('todoTaskBody');
  const list = sortedTasks();
  if (!list.length) {
    body.innerHTML = `<div class="panel-empty"><div class="panel-empty-ico"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="9 12 11 14 15 10"/></svg></div><div>No tasks yet.<br>Select text in a note and tap <strong style="color:var(--txt2)">Add to Tasks</strong>, or click <strong style="color:var(--txt2)">+ New</strong>.</div></div>`;
    return;
  }
  const PL = {critical:'⚡ Critical',important:'★ Important',normal:'● Normal',someday:'○ Someday'};
  body.innerHTML = list.map(t => {
    const od=isOverdue(t), m=t.mapId?getMapById(t.mapId):null;
    return `<div class="task-card${t.complete?' done':''}" data-tid="${t.id}">
      <div class="tc-top">
        <div class="tc-check" data-check="${t.id}">
          <svg class="tc-check-ico" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="tc-body">
          <div class="tc-title${!t.complete?' tc-editable':''}"
            ${!t.complete?`contenteditable="true" data-tedit="${t.id}" spellcheck="false"`:''}
          >${esc(t.title)}</div>
          <div class="tc-meta" style="margin-top:4px">
            <span class="prio-badge prio-${t.priority}">${{critical:'Critical',important:'Important',normal:'Normal',someday:'Someday'}[t.priority]||'Normal'}</span>
            ${t.sourceNoteTitle?`<span class="tc-tag tc-note-tag">📄 ${esc(t.sourceNoteTitle)}</span>`:''}
            ${m?`<span class="tc-tag tc-map-tag">🗺 ${esc(mapTitle(m))}</span>`:''}
            ${od&&!t.complete?`<span class="tc-tag tc-due-tag overdue">⚠ Overdue</span>`:''}
          </div>
          <div class="tc-inline-inputs">
            <select class="tc-inline-sel" data-pid="${t.id}">
              <option value="critical"${t.priority==='critical'?' selected':''}>⚡ Critical</option>
              <option value="important"${t.priority==='important'?' selected':''}>★ Important</option>
              <option value="normal"${t.priority==='normal'?' selected':''}>● Normal</option>
              <option value="someday"${t.priority==='someday'?' selected':''}>○ Someday</option>
            </select>
            <input type="date" class="tc-inline-inp" data-tddate="${t.id}" value="${t.dueDate||''}" title="Due date">
            <input type="time" class="tc-inline-inp" data-tdtime="${t.id}" value="${t.dueTime||''}" title="Due time"${!t.dueDate?' disabled':''}>
          </div>
        </div>
        <button class="tc-del" data-tdel="${t.id}" title="Delete task">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}
function renderTodoCal() {
  const grid = $('todoCalGrid'); if (!grid) return;
  const y=todoCalYear, mo=todoCalMonth, today=new Date();
  const first=new Date(y,mo,1).getDay(), days=new Date(y,mo+1,0).getDate();
  const off = first===0?6:first-1;
  $('todoCalMonthLabel').textContent = new Date(y,mo).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const tasksByDate = {};
  tasks.forEach(t => { if (!t.dueDate) return; (tasksByDate[t.dueDate]=tasksByDate[t.dueDate]||[]).push(t); });
  let html = ['Mo','Tu','We','Th','Fr','Sa','Su'].map((d,i)=>`<div class="todo-cal-dh" style="${i>=5?'color:var(--goldd)':''}">${d}</div>`).join('');
  for (let i=0;i<off;i++) html+='<div class="tc-empty" style="aspect-ratio:1"></div>';
  for (let d=1;d<=days;d++) {
    const ds=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isT=today.getDate()===d&&today.getMonth()===mo&&today.getFullYear()===y;
    const isS=todoCalSel===ds;
    const dt=tasksByDate[ds]||[];
    const dots=dt.slice(0,3).map(t=>`<div class="tc-dot tc-dot-${t.priority}"></div>`).join('');
    html+=`<div class="todo-cal-day${isT?' tc-today':''}${isS?' tc-sel':''}" data-tdate="${ds}"><span class="tc-day-num">${d}</span>${dots?`<div class="tc-day-dots">${dots}</div>`:''}</div>`;
  }
  grid.innerHTML = html;
  const selDate = todoCalSel || (today.getMonth()===mo&&today.getFullYear()===y ? `${y}-${String(mo+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}` : null);
  renderCalDayTasks(selDate ? tasksByDate[selDate]||[] : []);
}
function renderCalDayTasks(list) {
  const el=$('todoCalTaskList'); if (!el) return;
  const DC={critical:'#e05a4e',important:'var(--gold)',normal:'var(--txt3)',someday:'var(--green)'};
  if (!list.length) { el.innerHTML='<div style="color:var(--txt4);font-size:12px;padding:6px 0">No tasks on this day</div>'; return; }
  el.innerHTML = list.map(t=>`<div class="tct-item" data-tid="${t.id}"><div class="tct-prio-dot" style="background:${DC[t.priority]||DC.normal}"></div><span style="flex:1;${t.complete?'text-decoration:line-through;color:var(--txt3)':''}">${esc(t.title)}</span>${t.dueTime?`<span style="font-size:11px;color:var(--txt3)">${t.dueTime}</span>`:''}</div>`).join('');
}

/* ═══ MAP PANEL ═══ */
function openMapPanel() {
  closeTodoPanel(); curMapId=null;
  $('mapPanel').classList.add('panel-open');
  $('panelOverlay').classList.add('open');
  $('btnSbMap').classList.add('active');
  if ($('btnMap')) $('btnMap').classList.add('on');
  showMapList();
}
function closeMapPanel() {
  $('mapPanel').classList.remove('panel-open');
  $('btnSbMap').classList.remove('active');
  if ($('btnMap')) $('btnMap').classList.remove('on');
  if (!$('todoPanel').classList.contains('panel-open')) $('panelOverlay').classList.remove('open');
}
function showMapList() {
  curMapId=null;
  $('mapListView').style.display='flex'; $('mapDetailView').style.display='none';
  renderMapList();
}
function renderMapList() {
  const body=$('mapListBody'); if (!body) return;
  if (!maps.length) { body.innerHTML=`<div class="panel-empty"><div class="panel-empty-ico"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/></svg></div><div>No MAPs yet.<br>Create one to turn your goals into actionable plans.</div></div>`; return; }
  const SC={'Not Started':'mc-status-ns','In Progress':'mc-status-ip','Achieved':'mc-status-ach','Overdue':'mc-status-od'};
  body.innerHTML=maps.map(m=>{const pct=mapProgress(m),st=mapStatus(m);return `<div class="map-card" data-mid="${m.id}"><div class="mc-top"><div class="mc-title">${esc(mapTitle(m))}</div><span class="mc-status ${SC[st]||'mc-status-ns'}">${st}</span><button class="mc-export" data-mexp="${m.id}" title="Export MAP to a new note"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg></button><button class="mc-del" data-mdel="${m.id}" title="Delete MAP"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="mc-prog-bar-wrap"><div class="mc-prog-bar" style="width:${pct}%"></div></div><div class="mc-prog-txt">Progress: ${pct}%</div></div>`;}).join('');
}
function openMapDetail(id) {
  const m = id?getMapById(id):null; curMapId=m?m.id:null;
  $('mapListView').style.display='none'; $('mapDetailView').style.display='flex';
  populateMapDetail(m||{id:null,title:'',vision:'',mission:'',actionPlan:[],deadline:'',addToTodo:true});
}
function populateMapDetail(m) {
  $('mapDetailTitle').value = m.title||'';
  $('mdVision').innerText   = m.vision||'';
  $('mdMission').innerText  = m.mission||'';
  $('mdDeadline').value     = m.deadline||'';
  renderApItems(m.actionPlan||[]);
  const pct=m.id?mapProgress(m):0, st=m.id?mapStatus(m):'Not Started';
  $('mdProgressPct').textContent=$('mdProgressPct').textContent=pct+'%';
  $('mdProgressBar').style.width=pct+'%';
  $('mdStatusTxt').textContent=st; $('mdStatusTxt').className='mt-status-display '+statusCls(st);
  const addCb=$('mdAddToTodo'), chk=m.addToTodo!==false;
  addCb.classList.toggle('checked',chk); addCb.dataset.state=chk?'1':'0';
  addCb.innerHTML=chk?'<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':'';
  $('btnMapDelete').style.display    = m.id ? '' : 'none';
  $('btnMapDeleteHdr').style.display = m.id ? '' : 'none';
}
function statusCls(st) { return ({'In Progress':'mc-status-ip','Achieved':'mc-status-ach','Overdue':'mc-status-od'})[st]||'mc-status-ns'; }
function renderApItems(items) {
  const el=$('mdActionPlan');
  el.innerHTML=items.map(ap=>`<div class="ap-item" data-apid="${ap.id}"><div class="ap-check${ap.done?' checked':''}" data-apdone="${ap.id}">${ap.done?'<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':''}</div><input class="ap-text${ap.done?' done-text':''}" value="${esc(ap.text)}" placeholder="Action step…" data-apinp="${ap.id}"><button class="ap-del" data-apdel="${ap.id}">×</button></div>`).join('')+`<button class="ap-add-btn" id="apAddBtn">+ Add action step</button>`;
}
function collectMapSave() {
  const m=curMapId?getMapById(curMapId):null;
  const apItems=Array.from($('mdActionPlan').querySelectorAll('.ap-item')).map(el=>{
    const id=el.dataset.apid, inp=el.querySelector('.ap-text'), chk=el.querySelector('.ap-check');
    const old=m&&m.actionPlan?m.actionPlan.find(a=>a.id===id):null;
    return {id, text:inp?inp.value.trim():'', done:old?old.done:(chk&&chk.classList.contains('checked'))};
  }).filter(a=>a.text);
  return {title:($('mapDetailTitle').value||'').trim(), vision:($('mdVision').innerText||'').trim(), mission:($('mdMission').innerText||'').trim(), actionPlan:apItems, deadline:$('mdDeadline').value||'', addToTodo:$('mdAddToTodo').dataset.state==='1'};
}
function saveMap() {
  const data=collectMapSave(); let m;
  if (curMapId) { m=getMapById(curMapId); if (!m) return; Object.assign(m,data,{modified:Date.now()}); }
  else { m=createNewMap(); Object.assign(m,data,{created:Date.now(),modified:Date.now()}); curMapId=m.id; }
  persistMaps();
  if (data.addToTodo) syncApToTasks(m);
  updateMapBadge();
  const pct=mapProgress(m),st=mapStatus(m);
  $('mdProgressPct').textContent=pct+'%'; $('mdProgressBar').style.width=pct+'%';
  $('mdStatusTxt').textContent=st; $('mdStatusTxt').className='mt-status-display '+statusCls(st);
  $('btnMapDelete').style.display='';
  toast('MAP saved ✓','ok');
}
function syncApToTasks(m) {
  (m.actionPlan||[]).forEach(ap => {
    if (!ap.text) return;
    const exists=tasks.find(t=>t.mapId===m.id&&t.title===ap.text);
    if (!exists) createTask({title:ap.text,mapId:m.id,priority:'normal'});
    else if (exists.complete!==ap.done) { exists.complete=ap.done; persistTasks(); updateTodoBadge(); }
  });
}

/* ── Context menu ── */
function showCtxMenu(x,y) {
  const menu=$('ctxMenu'); const vw=window.innerWidth,vh=window.innerHeight;
  menu.style.left=Math.min(x,vw-165)+'px'; menu.style.top=Math.min(y,vh-50)+'px';
  menu.classList.add('open');
}
function hideCtxMenu() { $('ctxMenu').classList.remove('open'); ctxSelText=null; ctxSelItems=null; }

/* ── Task modal ── */
function setPrioPill(p) {
  $('tcPriority').value = p;
  $('tcPrioPills').querySelectorAll('.prio-pill').forEach(btn => {
    btn.className = 'prio-pill' + (btn.dataset.prio === p ? ' pp-active-' + p : '');
  });
}
function openTaskModal(title, noteId, noteTtl) {
  $('tcSingleMode').style.display = 'block';
  $('tcBatchMode').style.display  = 'none';
  $('tcModalTitle').textContent   = 'Add Task';
  $('tcTitle').textContent        = title || '';
  $('btnSaveTask').textContent    = 'Add Task';
  setPrioPill('normal');
  $('tcDueDate').value = ''; $('tcDueTime').value = '';
  $('tcTaskModal').dataset.noteId  = noteId  || '';
  $('tcTaskModal').dataset.noteTtl = noteTtl || '';
  $('tcTaskModal').dataset.mode    = 'single';
  $('tcTaskModal').classList.add('open');
  setTimeout(() => { $('tcTitle').focus(); const r=document.createRange(),s=window.getSelection(); r.selectNodeContents($('tcTitle')); r.collapse(false); s.removeAllRanges(); s.addRange(r); }, 50);
}
function openBatchModal(items, noteId, noteTtl) {
  $('tcSingleMode').style.display = 'none';
  $('tcBatchMode').style.display  = 'block';
  $('tcModalTitle').textContent   = `Add ${items.length} Tasks`;
  $('tcBatchList').innerHTML = items.map((text,i) =>
    `<label class="tc-batch-item"><input type="checkbox" checked class="tc-batch-cb" data-bidx="${i}"><span>${esc(text)}</span></label>`
  ).join('');
  $('tcBatchList').dataset.items = JSON.stringify(items);
  setPrioPill('normal');
  $('tcDueDate').value = ''; $('tcDueTime').value = '';
  $('tcTaskModal').dataset.noteId  = noteId  || '';
  $('tcTaskModal').dataset.noteTtl = noteTtl || '';
  $('tcTaskModal').dataset.mode    = 'batch';
  updateBatchCount();
  $('tcTaskModal').classList.add('open');
}
function updateBatchCount() {
  const checked = $('tcBatchList').querySelectorAll('.tc-batch-cb:checked').length;
  const total   = $('tcBatchList').querySelectorAll('.tc-batch-cb').length;
  $('tcBatchCount').textContent    = `${checked} of ${total} items selected`;
  $('btnSaveTask').textContent     = `Add ${checked} Task${checked!==1?'s':''}`;
}
function closeTaskModal() { $('tcTaskModal').classList.remove('open'); }

/* Strip leading list markers (numbers, letters, bullets, checkboxes) from a line */
function stripBullet(s) {
  return (s || '').replace(/^\s*(?:[-•*▪◦·]|\d+[.)]|[a-zA-Z][.)]|\[[ xX]?\])\s+/, '').trim();
}
function cleanSelectionItems(raw) {
  return raw.map(t => stripBullet(t)).filter(Boolean);
}
/* Detect multiple highlighted points from a selection.
   Returns an array of cleaned items when >1 point is detected, else null. */
function getSelectionItems(sel) {
  sel = sel || window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const wrap = document.createElement('div');
  wrap.appendChild(sel.getRangeAt(0).cloneContents());

  const fromBlocks = (selector) => {
    const nodes = wrap.querySelectorAll(selector);
    if (nodes.length <= 1) return null;
    const items = cleanSelectionItems(Array.from(nodes).map(n => n.textContent));
    return items.length > 1 ? items : null;
  };

  // HTML list items
  const listItems = fromBlocks('li');
  if (listItems) return listItems;

  // Note paragraphs (editor lines are <p> blocks, not <li>)
  const paragraphs = fromBlocks('p');
  if (paragraphs) return paragraphs;

  // Any multi-line selection: one task per non-empty line
  const lines = cleanSelectionItems(
    (wrap.innerText || wrap.textContent || '').split(/\r?\n/)
  );
  if (lines.length > 1) return lines;
  return null;
}

/* ── MAP field tooltips (fixed for both hover and tap) ── */
const MAP_TIPS = {
  vision:'The desired outcome, goal, purpose, or destination you want to achieve.',
  mission:'The strategy, approach, or commitment that will help you achieve the vision.',
  actionPlan:'The specific tasks and activities required to move toward the vision.',
  deadline:'The target completion date and time.',
  progress:'Automatically calculated based on completed Action Plan tasks.',
  status:'Current state of the MAP: Not Started, In Progress, Achieved, or Overdue.'
};
const ttip = $('fieldTooltip');
function showTip(el, key) {
  ttip.textContent = MAP_TIPS[key] || ''; ttip.classList.add('open');
  const r = el.getBoundingClientRect();
  ttip.style.left = Math.min(r.right+6, window.innerWidth-230)+'px'; ttip.style.top = r.top+'px';
}
function hideTip() { ttip.classList.remove('open'); }
let tipAnchorKey  = null;
let lastTipShowMs = 0;
function showTipFor(b) {
  showTip(b, b.dataset.tip); tipAnchorKey = b.dataset.tip; lastTipShowMs = Date.now();
}
$('mapPanel').addEventListener('mouseover', e => {
  const b = e.target.closest('.mt-info-btn');
  if (b && b.dataset.tip) showTipFor(b);
});
$('mapPanel').addEventListener('mouseout', e => {
  if (e.target.closest('.mt-info-btn')) { hideTip(); tipAnchorKey = null; }
});
$('mapPanel').addEventListener('click', e => {
  const b = e.target.closest('.mt-info-btn');
  if (!b || !b.dataset.tip) return;
  e.stopPropagation(); e.preventDefault();
  if (Date.now() - lastTipShowMs < 200) return; // mobile: keep tip shown after simulated mouseover
  if (tipAnchorKey === b.dataset.tip && ttip.classList.contains('open')) {
    hideTip(); tipAnchorKey = null;
  } else { showTipFor(b); }
});
document.addEventListener('click', e => {
  if (!e.target.closest('#mapPanel')) { hideTip(); tipAnchorKey = null; }
});

/* MAP header Save / Delete buttons (always visible) */
$('btnMapSaveHdr').addEventListener('click', saveMap);
$('btnMapExportNote').addEventListener('click', () => exportMapToNote(collectMapSave()));
$('btnMapDeleteHdr').addEventListener('click', () => $('btnMapDelete').click());

/* ════════════════════════════════════════
   EVENT HANDLERS — TODO/MAP SYSTEM
════════════════════════════════════════ */
$('btnSbTodo').addEventListener('click',()=>{ $('todoPanel').classList.contains('panel-open')?closeTodoPanel():openTodoPanel(); });
$('btnSbMap').addEventListener('click', ()=>{ $('mapPanel').classList.contains('panel-open')?closeMapPanel():openMapPanel(); });
if ($('btnTodo')) $('btnTodo').addEventListener('click',e=>{ e.stopPropagation(); $('todoPanel').classList.contains('panel-open')?closeTodoPanel():openTodoPanel(); });
if ($('btnMap'))  $('btnMap').addEventListener('click', e=>{ e.stopPropagation(); $('mapPanel').classList.contains('panel-open')?closeMapPanel():openMapPanel(); });

$('panelOverlay').addEventListener('click',()=>{ closeTodoPanel(); closeMapPanel(); });
$('btnTodoClose').addEventListener('click',closeTodoPanel);
$('btnExportTasks').addEventListener('click', exportTasksToNote);
$('btnNewTask').addEventListener('click',()=>{ const n=cur?getNote(cur):null; openTaskModal('',cur||null,n?noteTitle(n):''); });
$('todoSortSel').addEventListener('change',e=>{ todoSortMode=e.target.value; renderTaskList(); });
$('todoTabList').addEventListener('click',()=>{ todoView='list'; $('todoTabList').classList.add('active'); $('todoTabCal').classList.remove('active'); renderTodoPanel(); });
$('todoTabCal').addEventListener('click', ()=>{ todoView='calendar'; $('todoTabList').classList.remove('active'); $('todoTabCal').classList.add('active'); renderTodoPanel(); });

/* Save priority / date / time on change */
$('todoCalPrev').addEventListener('click',()=>{ if(--todoCalMonth<0){todoCalMonth=11;todoCalYear--;} renderTodoCal(); });
$('todoCalNext').addEventListener('click',()=>{ if(++todoCalMonth>11){todoCalMonth=0;todoCalYear++;} renderTodoCal(); });
$('todoCalGrid').addEventListener('click',e=>{ const d=e.target.closest('[data-tdate]'); if(d){todoCalSel=d.dataset.tdate;renderTodoCal();} });
$('todoCalTaskList').addEventListener('click',e=>{ if(e.target.closest('.tct-item')){ todoView='list'; $('todoTabList').classList.add('active'); $('todoTabCal').classList.remove('active'); renderTodoPanel(); } });

$('btnMapClose').addEventListener('click',closeMapPanel);
$('btnNewMap').addEventListener('click',()=>openMapDetail(null));
$('btnMapBack').addEventListener('click',showMapList);
$('btnMapSave').addEventListener('click',saveMap);
$('btnMapDelete').addEventListener('click',()=>{
  if(!curMapId) return;
  const linked=tasks.filter(t=>t.mapId===curMapId);
  if(!confirm(linked.length?`This MAP has ${linked.length} linked task${linked.length>1?'s':''}. Deleting will unlink them. Continue?`:'Delete this MAP?')) return;
  deleteMapById(curMapId); showMapList(); toast('MAP deleted');
});
$('mapListBody').addEventListener('click',e=>{
  const exp=e.target.closest('[data-mexp]'), del=e.target.closest('[data-mdel]'), card=e.target.closest('.map-card');
  if (exp) {
    e.stopPropagation();
    const m=getMapById(exp.dataset.mexp);
    if (m) exportMapToNote(m);
    return;
  }
  if (del) {
    e.stopPropagation();
    const id=del.dataset.mdel, linked=tasks.filter(t=>t.mapId===id);
    if(!confirm(linked.length?`This MAP has ${linked.length} linked task${linked.length>1?'s':''}. Deleting will unlink them. Continue?`:'Delete this MAP?')) return;
    deleteMapById(id); renderMapList(); updateMapBadge(); return;
  }
  if (card) openMapDetail(card.dataset.mid);
});

$('mdActionPlan').addEventListener('click',e=>{
  const done=e.target.closest('[data-apdone]'), del=e.target.closest('[data-apdel]'), add=e.target.closest('#apAddBtn');
  if (done) {
    const cb=done; cb.classList.toggle('checked');
    const checked=cb.classList.contains('checked');
    cb.innerHTML=checked?'<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':'';
    const inp=done.closest('.ap-item').querySelector('.ap-text');
    if(inp) inp.classList.toggle('done-text',checked);
    if(curMapId){ const m=getMapById(curMapId),id=done.dataset.apdone; if(m){const ap=m.actionPlan.find(a=>a.id===id); if(ap){ap.done=checked;persistMaps();const t=tasks.find(tk=>tk.mapId===curMapId&&tk.title===ap.text);if(t){t.complete=checked;persistTasks();updateTodoBadge();}}} const mn=getMapById(curMapId); if(mn){$('mdProgressPct').textContent=mapProgress(mn)+'%';$('mdProgressBar').style.width=mapProgress(mn)+'%';$('mdStatusTxt').textContent=mapStatus(mn);$('mdStatusTxt').className='mt-status-display '+statusCls(mapStatus(mn));} }
    return;
  }
  if (del) { del.closest('.ap-item').remove(); return; }
  if (add) {
    const id=uid(), div=document.createElement('div');
    div.className='ap-item'; div.dataset.apid=id;
    div.innerHTML=`<div class="ap-check" data-apdone="${id}"></div><input class="ap-text" value="" placeholder="Action step…" data-apinp="${id}"><button class="ap-del" data-apdel="${id}">×</button>`;
    $('apAddBtn').before(div); div.querySelector('.ap-text').focus();
  }
});
$('mdAddToTodo').addEventListener('click',function(){
  const on=!this.classList.contains('checked');
  this.classList.toggle('checked',on); this.dataset.state=on?'1':'0';
  this.innerHTML=on?'<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':'';
});

/* Context menu on text selection */
editor.addEventListener('mouseup',()=>{
  setTimeout(()=>{
    const sel=window.getSelection();
    if(sel&&!sel.isCollapsed&&sel.toString().trim().length>0){
      const r=sel.getRangeAt(0), rect=r.getBoundingClientRect();
      ctxSelText=sel.toString().trim();
      ctxSelItems=getSelectionItems(sel);
      showCtxMenu(rect.left+rect.width/2-78, rect.top-50);
    } else hideCtxMenu();
  },10);
});
editor.addEventListener('touchend',()=>{
  setTimeout(()=>{
    const sel=window.getSelection();
    if(sel&&!sel.isCollapsed&&sel.toString().trim().length>0){
      const r=sel.getRangeAt(0), rect=r.getBoundingClientRect();
      ctxSelText=sel.toString().trim();
      ctxSelItems=getSelectionItems(sel);
      showCtxMenu(rect.left,rect.top-55);
    }
  },50);
});
$('ctxMenu').addEventListener('click',e=>{
  const item=e.target.closest('[data-ctx]'); if(!item) return;
  if(item.dataset.ctx==='addTask'){
    const selText = ctxSelText || (window.getSelection()?.toString().trim() || '');
    const items = ctxSelItems || getSelectionItems();
    hideCtxMenu();
    const n=cur?getNote(cur):null, noteId=cur||null, noteTtl=n?noteTitle(n):'';
    if(items && items.length>1) {
      items.forEach(title => createTask({title,sourceNoteId:noteId,sourceNoteTitle:noteTtl,priority:'normal',dueDate:'',dueTime:''}));
      renderTodoPanel();
      toast(`${items.length} tasks added ✓`,'ok');
    } else {
      const title = stripBullet(selText);
      openTaskModal(title, noteId, noteTtl);
    }
  }
});
document.addEventListener('mousedown',e=>{ if(!e.target.closest('#ctxMenu'))hideCtxMenu(); });

/* Priority pills in task modal */
$('tcPrioPills').addEventListener('click',e=>{
  const btn=e.target.closest('[data-prio]'); if(btn) setPrioPill(btn.dataset.prio);
});
/* Batch checkbox changes */
$('tcBatchList').addEventListener('change',()=>updateBatchCount());

/* Task modal save */
$('btnSaveTask').addEventListener('click',()=>{
  const noteId=$('tcTaskModal').dataset.noteId||null;
  const noteTtl=$('tcTaskModal').dataset.noteTtl||'';
  const priority=$('tcPriority').value;
  const dueDate=$('tcDueDate').value;
  const dueTime=$('tcDueTime').value;
  if($('tcTaskModal').dataset.mode==='batch'){
    const items=JSON.parse($('tcBatchList').dataset.items||'[]');
    const checked=Array.from($('tcBatchList').querySelectorAll('.tc-batch-cb:checked')).map(cb=>parseInt(cb.dataset.bidx));
    if(!checked.length){toast('Select at least one task','err');return;}
    checked.forEach(i=>{ if(items[i]) createTask({title:items[i],sourceNoteId:noteId,sourceNoteTitle:noteTtl,priority,dueDate,dueTime}); });
    closeTaskModal(); renderTodoPanel(); toast(`${checked.length} task${checked.length>1?'s':''} added ✓`,'ok');
  } else {
    const title=($('tcTitle').textContent||'').trim();
    if(!title){toast('Enter a task title','err');return;}
    createTask({title,sourceNoteId:noteId,sourceNoteTitle:noteTtl,priority,dueDate,dueTime});
    closeTaskModal(); renderTodoPanel(); toast('Task added ✓','ok');
  }
});
$('btnCancelTask').addEventListener('click',closeTaskModal);

/* Task list: check/delete/inline-edit */
$('todoTaskBody').addEventListener('click',e=>{
  const chk=e.target.closest('[data-check]'), del=e.target.closest('[data-tdel]');
  if(chk){e.stopPropagation();toggleTask(chk.dataset.check);renderTodoPanel();return;}
  if(del){e.stopPropagation();deleteTask(del.dataset.tdel);renderTodoPanel();return;}
});
/* Save title on blur */
$('todoTaskBody').addEventListener('blur',e=>{
  const edit=e.target.closest('[data-tedit]');
  if(edit){const t=getTask(edit.dataset.tedit);const v=edit.textContent.trim();if(t&&v&&v!==t.title){t.title=v;persistTasks();}}
},true);
/* Save priority / date / time on change */
$('todoTaskBody').addEventListener('change',e=>{
  const ps=e.target.closest('[data-pid]');
  const dd=e.target.closest('[data-tddate]');
  const dt=e.target.closest('[data-tdtime]');
  if(ps){updateTaskPriority(ps.dataset.pid,ps.value);renderTaskList();return;}
  if(dd){const t=getTask(dd.dataset.tddate);if(t){t.dueDate=dd.value;persistTasks();renderTaskList();}return;}
  if(dt){const t=getTask(dt.dataset.tdtime);if(t){t.dueTime=dt.value;persistTasks();renderTaskList();}return;}
});

/* ESC closes panels */
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){closeTodoPanel();closeMapPanel();hideCtxMenu();hideTip();closeTaskModal();} });

/* ═══════════════════════════════
   INIT
═══════════════════════════════ */
loadNotes();
loadTasks();
loadMaps();
renderList();
updateTodoBadge();
updateMapBadge();

welcome.style.display  = 'flex';
editorUI.style.display = 'none';

/* Refresh note list dates periodically */
setInterval(() => {
  if (notes.length) renderList();
}, 60000);

console.log('%cPencraft Notes loaded ✓', 'color:#c89038;font-weight:bold;font-size:14px;');



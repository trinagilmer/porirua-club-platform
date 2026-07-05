// backend/public/js/functions/notes-editor.js
// Edit-in-editor flow: click a note -> load into editor -> preview/save (create or update)

(function () {
  // ---- Helpers ----
  const qs  = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const editorEl     = qs("#noteEditor");
  const tplSelectEl  = qs("#templateSelect");
  const previewPane  = qs("#previewPane");
  const saveBtn      = qs("#saveNote");
  const previewBtn   = qs("#previewNote");

  function toast(msg, type = "info") {
    // Replace with your toast system if you have one
    console[type === "error" ? "error" : "log"](`[Notes] ${msg}`);
  }
  function getFnId() {
    return window.fnContext?.id || window.functionId || null;
  }
  function getStatusRadio() {
    return (qs('input[name="note_status"]:checked') || {}).value || "general";
  }
  function setStatusRadio(val) {
    const v = (val || "general").toLowerCase();
    (function () {
      const qs  = (sel, el = document) => el.querySelector(sel);
      const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
      const editorEl     = qs("#noteEditor");
      const tplSelectEl  = qs("#templateSelect");
      const previewPane  = qs("#previewPane");
      const saveBtn      = qs("#saveNote");
      const previewBtn   = qs("#previewNote");

      function toast(msg, type = "info") {
        console[type === "error" ? "error" : "log"](`[Notes] ${msg}`);
      }
      function getFnId() { return window.fnContext?.id || window.functionId || null; }
      function getStatusRadio() { return (qs('input[name="note_status"]:checked') || {}).value || "general"; }
      function setStatusRadio(val) { const v = (val || "general").toLowerCase(); const input = qs(`input[name="note_status"][value="${v}"]`); if (input) input.checked = true; }
      function getStatusFromColumn(noteEl) { const label = (noteEl.closest(".notes-card")?.querySelector("header span")?.textContent || "").toLowerCase(); if (label.includes("proposal")) return "proposal"; if (label.includes("internal")) return "internal"; return "general"; }

      if (!editorEl) { console.warn("⚠️ notes-editor.js: #noteEditor not found"); return; }

      // Initialize Quill (the page includes Quill vendor script)
      const quill = new Quill('#noteEditor', {
        theme: 'snow',
        modules: { toolbar: false, history: { delay: 1000, maxStack: 100 } }
      });

      // ---- Toolbar buttons -> Quill actions ----
      qsa('[data-cmd]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cmd = btn.dataset.cmd;
          const value = btn.dataset.value;
          switch (cmd) {
            case 'bold': quill.format('bold', !quill.getFormat().bold); break;
            case 'italic': quill.format('italic', !quill.getFormat().italic); break;
            case 'underline': quill.format('underline', !quill.getFormat().underline); break;
            case 'removeFormat': quill.removeFormat(quill.getSelection(true).index, quill.getSelection(true).length||0); break;
            case 'formatBlock':
              if (value === 'h2') quill.format('header', 2);
              else if (value === 'h3') quill.format('header', 3);
              else if (value === 'p') quill.format('header', false);
              else if (value === 'blockquote') quill.format('blockquote', true);
              break;
            case 'insertUnorderedList': quill.format('list','bullet'); break;
            case 'insertOrderedList': quill.format('list','ordered'); break;
            case 'justifyLeft': quill.format('align', 'left'); break;
            case 'justifyCenter': quill.format('align', 'center'); break;
            case 'justifyRight': quill.format('align', 'right'); break;
            case 'undo': quill.history.undo(); break;
            case 'redo': quill.history.redo(); break;
            case 'unlink': quill.format('link', false); break;
            default: console.log('Unhandled cmd', cmd); break;
          }
          quill.focus();
        });
      });

      // Link action (prompt)
      const linkBtn = qs('[data-action="link"]');
      if (linkBtn) linkBtn.addEventListener('click', () => {
        const url = window.prompt('Enter URL (including https://)');
        if (!url) return;
        const sel = quill.getSelection();
        if (sel && sel.length > 0) {
          quill.format('link', url);
        } else {
          // insert link text
          const idx = sel ? sel.index : quill.getLength()-1;
          quill.insertText(idx, url, { link: url });
        }
        quill.focus();
      });

      // Token insertion
      qsa('.token-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key; if (!key) return;
          const sel = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
          quill.insertText(sel.index, `{{${key}}}`);
          quill.setSelection(sel.index + (`{{${key}}}`).length, 0);
          quill.focus();
        });
      });

      // Template loading
      if (tplSelectEl) {
        tplSelectEl.addEventListener('change', () => {
          const id = tplSelectEl.value;
          const tpl = (window.fnContext?.templates || []).find(t => String(t.id) === String(id));
          if (!tpl) return;
          if (tpl.content) {
            quill.clipboard.dangerouslyPasteHTML(tpl.content);
          } else if (tpl.content_json) {
            try { quill.setContents(JSON.parse(tpl.content_json)); } catch (e) { quill.clipboard.dangerouslyPasteHTML('<p><em>Template JSON could not be loaded.</em></p>'); }
          } else {
            quill.setText('');
          }
          quill.focus();
          // clear current note selection
          currentNoteId = null;
        });
      }

      // Quick table insert
      qsa('[data-insert-table]').forEach(btn => {
        btn.addEventListener('click', () => {
          const rows = parseInt(btn.dataset.rows || '2', 10);
          const cols = parseInt(btn.dataset.cols || '2', 10);
          let html = '<table style="width:100%;border-collapse:collapse" border="1">';
          for (let r=0;r<rows;r++){ html += '<tr>'; for (let c=0;c<cols;c++){ html += '<td style="padding:6px">&nbsp;</td>'; } html += '</tr>'; } html += '</table>';
          const sel = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
          quill.clipboard.dangerouslyPasteHTML(sel.index, html);
          quill.focus();
        });
      });

      // Click to edit existing note
      let currentNoteId = null;
      qsa('.note-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select, textarea')) return;
          const id = item.getAttribute('data-note-id');
          const html = qs('.note-html', item)?.innerHTML || '';
          const status = getStatusFromColumn(item);
          currentNoteId = id || null;
          setStatusRadio(status);
          quill.clipboard.dangerouslyPasteHTML(html);
          quill.focus();
          if (tplSelectEl) tplSelectEl.value = '';
        });
      });

      // Save (create/update)
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const fnId = getFnId(); if (!fnId) return toast('Missing function ID','error');
          const rendered_html = quill.root.innerHTML.trim(); if (!rendered_html) return toast('Nothing to save — the editor is empty','error');
          const payload = { rendered_html, content_json: JSON.stringify(quill.getContents()), note_type: getStatusRadio() };
          try {
            let endpoint;
            if (currentNoteId) endpoint = `/functions/notes/${encodeURIComponent(currentNoteId)}/update`;
            else endpoint = `/functions/${encodeURIComponent(fnId)}/notes/new`;
            const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.message || 'Save failed');
            toast(currentNoteId ? 'Note updated' : 'Note created'); currentNoteId = null; quill.setText(''); window.location.reload();
          } catch (err) { console.error(err); toast(`Save error: ${err.message}`,'error'); }
        });
      }

      // Preview
      if (previewBtn && previewPane) {
        previewBtn.addEventListener('click', async () => {
          const fnId = getFnId(); if (!fnId) return toast('Missing function ID','error');
          const raw_html = quill.root.innerHTML.trim(); if (!raw_html) return toast('Nothing to preview','error');
          try {
            const res = await fetch(`/functions/${encodeURIComponent(fnId)}/notes/preview`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ raw_html }) });
            const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.message || 'Preview failed');
            previewPane.innerHTML = data.merged || ''; previewPane.scrollIntoView({ behavior:'smooth', block:'nearest' });
          } catch (err) { console.error(err); toast(`Preview error: ${err.message}`,'error'); }
        });
      }

      // Let Quill handle paste for better sanitization; optional custom handlers could be added here
    })();
          method,

          headers: { "Content-Type": "application/json" },

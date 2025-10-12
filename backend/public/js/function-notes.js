document.addEventListener('DOMContentLoaded', () => {
  const fnId = window.location.pathname.split('/')[2];
  const newForm = document.getElementById('newNoteForm');
  const newContent = document.getElementById('newNoteContent');

  newForm.addEventListener('submit', async e => {
    e.preventDefault();
    const res = await fetch(`/functions/${fnId}/notes/new`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ content: newContent.value })
    });
    if ((await res.json()).success) location.reload();
  });

  document.querySelectorAll('.edit-note').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.target.closest('.note-card');
      const body = card.querySelector('.note-body');
      const save = card.querySelector('.save-note');
      body.contentEditable = true;
      body.focus();
      save.classList.remove('hidden');
      btn.classList.add('hidden');
    });
  });

  document.querySelectorAll('.save-note').forEach(btn => {
    btn.addEventListener('click', async e => {
      const card = e.target.closest('.note-card');
      const id = card.dataset.id;
      const content = card.querySelector('.note-body').innerHTML;
      const res = await fetch(`/functions/notes/${id}/update`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ content })
      });
      if ((await res.json()).success) location.reload();
    });
  });

  document.querySelectorAll('.delete-note').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.closest('.note-card').dataset.id;
      if (!confirm('Delete this note?')) return;
      await fetch(`/functions/notes/${id}`, { method: 'DELETE' });
      location.reload();
    });
  });

  document.querySelectorAll('.print-note').forEach(btn => {
    btn.addEventListener('click', e => {
      const note = e.target.closest('.note-card').innerHTML;
      const w = window.open('', '', 'width=600,height=400');
      w.document.write(`<html><body>${note}</body></html>`);
      w.print();
      w.close();
    });
  });
});

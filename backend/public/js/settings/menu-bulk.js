document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('bulkForm');
  const input = document.getElementById('bulkInput');
  const uploadType = document.getElementById('uploadType');
  const categorySelect = document.getElementById('categorySelect');
  const statusEl = document.getElementById('bulkStatus');
// 👇 ADD THIS SECTION RIGHT HERE
  const linkHelper = document.getElementById('linkHelper');
  const menuSelect = document.getElementById('menuSelect');
  const choiceSelect = document.getElementById('choiceSelect');
  const addLinkBtn = document.getElementById('addLinkBtn');

  // 🔹 Show/hide link helper depending on selected upload type
  uploadType.addEventListener('change', () => {
    if (uploadType.value === 'link') {
      linkHelper.style.display = '';
    } else {
      linkHelper.style.display = 'none';
    }
  });

  // 🔹 Append "menu_id, choice_id" pair to text area when clicking Add Link
  if (addLinkBtn) {
    addLinkBtn.addEventListener('click', () => {
      const m = menuSelect.value;
      const c = choiceSelect.value;
      if (!m || !c) return alert('Select both a menu and a choice first.');
      input.value += `${m}, ${c}\n`;
    });
  }
  if (!form) return;

  // ======================================================
  // 🔹 Handle Form Submit
  // ======================================================
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = (input.value || '').trim();
    if (!raw) return alert('Please paste or enter data first.');

    // Split each line of pasted text into columns
    const items = raw
      .split('\n')
      .map(line => line.split(',').map(x => x.trim()))
      .filter(parts => parts[0]); // must have at least name

    let parsedItems = [];

    // ======================================================
    // 🔸 Menu Mode — name, price, description (optional)
    // ======================================================
if (uploadType.value === 'menu') {
  parsedItems = items.map(cols => ({
    name: cols[0],
    price: cols[1] ? parseFloat(cols[1]) || null : null,
    description: cols[2] || null
  }));
}
else if (uploadType.value === 'choice') {
  parsedItems = items.map(cols => ({
    name: cols[0]
  }));
}

else if (uploadType.value === 'link') {
  parsedItems = items.map(cols => ({
    menu_id: parseInt(cols[0]) || null,
    choice_id: parseInt(cols[1]) || null
  }));
}

    // ======================================================
    // 🔸 Add-on Mode — name, price, menu_item_id, enable_quantity, enable_guest_quantity, unit_id (optional)
    // ======================================================
    else if (uploadType.value === 'addon') {
      parsedItems = items.map(cols => ({
        name: cols[0],
        price: cols[1] ? parseFloat(cols[1]) || null : null,
        menu_item_id: cols[2] ? parseInt(cols[2]) || null : null,
        enable_quantity: parseBoolean(cols[3]),
        enable_guest_quantity: parseBoolean(cols[4]),
        unit_id: cols[5] ? parseInt(cols[5]) || null : null
      }));
    }

    // Build payload for backend
    const payload = {
      type: uploadType.value,
      category_id: categorySelect.value || null,
      items: parsedItems
    };

    // ======================================================
    // 🔹 Send to backend
    // ======================================================
    try {
      const res = await fetch('/settings/menus/bulk/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();

      if (result.success) {
        showStatus('✅ Bulk upload completed successfully!', 'success');
        input.value = '';
      } else {
        showStatus('❌ ' + (result.error || 'Upload failed'), 'danger');
      }
    } catch (err) {
      console.error('❌ Bulk upload error:', err);
      showStatus('❌ Server error during upload', 'danger');
    }
  });

  // ======================================================
  // 🔹 Helper — Convert strings to booleans
  // ======================================================
  function parseBoolean(value) {
    if (!value) return false;
    return ['1', 'true', 'yes', 'y'].includes(value.toString().toLowerCase());
  }

  // ======================================================
  // 🔹 Helper — Show status message
  // ======================================================
  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = `alert alert-${type}`;
    statusEl.classList.remove('d-none');
  }
});


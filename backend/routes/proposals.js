// backend/routes/proposals.js
const express = require('express');
const router = express.Router();
const supabase = require('../../supabaseClient');

// Utility function for consistent responses
const handleResponse = (res, { data, error }, successCode = 200) => {
  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
  return res.status(successCode).json({ success: true, data });
};

// Helper to safely recalc proposal totals
const recalcTotals = async (proposal_id) => {
  const { data: items, error: itemsErr } = await supabase
    .from('proposal_items')
    .select('quantity, unit_price')
    .eq('proposal_id', proposal_id);

  if (itemsErr) throw itemsErr;

  const subtotal = items.reduce((acc, i) => acc + (i.quantity || 0) * (Number(i.unit_price) || 0), 0);

  // get gratuity and discount from settings if needed
  const { data: totals, error: totalsErr } = await supabase
    .from('proposal_totals')
    .select('*')
    .eq('proposal_id', proposal_id)
    .maybeSingle();

  if (totalsErr) throw totalsErr;

  const gratuity_percent = totals?.gratuity_percent || 0;
  const discount_amount = totals?.discount_amount || 0;
  const deposit_amount = totals?.deposit_amount || 0;
  const gratuity_amount = subtotal * (gratuity_percent / 100);
  const grand_total = subtotal + gratuity_amount - discount_amount - deposit_amount;

  const { data: payments, error: payErr } = await supabase
    .from('payments')
    .select('amount')
    .eq('proposal_id', proposal_id);

  if (payErr) throw payErr;
  const total_paid = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const remaining_due = grand_total - total_paid;

  // upsert totals row
  const { error: updateErr } = await supabase
    .from('proposal_totals')
    .upsert({
      proposal_id,
      subtotal,
      gratuity_percent,
      gratuity_amount,
      discount_amount,
      deposit_amount,
      total_paid,
      remaining_due
    }, { onConflict: 'proposal_id' });

  if (updateErr) throw updateErr;
  return { subtotal, gratuity_amount, total_paid, remaining_due };
};

// =========================
// 1️⃣ Get all proposals
// =========================
router.get('/', async (req, res) => {
  const result = await supabase
    .from('proposals')
    .select(`
      id, status, created_at, contact_id, function_id,
      proposal_totals(subtotal, remaining_due, total_paid)
    `)
    .order('created_at', { ascending: false });
  handleResponse(res, result);
});

// =========================
// 2️⃣ Get proposal details
// =========================
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('proposals')
    .select(`
      *,
      proposal_items(id, item_type, description, quantity, unit_price, show_on_proposal),
      proposal_totals(subtotal, gratuity_amount, discount_amount, deposit_amount, total_paid, remaining_due),
      payments(id, payment_type, amount, status, method, paid_on)
    `)
    .eq('id', id)
    .single();

  handleResponse(res, { data, error });
});

// =========================
// 3️⃣ Create new proposal
// =========================
router.post('/', async (req, res) => {
  const { contact_id, function_id, status = 'draft' } = req.body;

  const { data, error } = await supabase
    .from('proposals')
    .insert([{ contact_id, function_id, status }])
    .select()
    .single();

  if (error) return handleResponse(res, { error });

  // Initialize totals row
  await supabase.from('proposal_totals').insert([{ proposal_id: data.id, subtotal: 0 }]);
  handleResponse(res, { data }, 201);
});

// =========================
// 4️⃣ Add an item to a proposal
// =========================
router.post('/:proposal_id/items', async (req, res) => {
  const { proposal_id } = req.params;
  const { item_type, description, quantity, unit_price, show_on_proposal = true } = req.body;

  const insert = await supabase
    .from('proposal_items')
    .insert([{ proposal_id, item_type, description, quantity, unit_price, show_on_proposal }])
    .select();

  if (insert.error) return handleResponse(res, insert);

  // Recalculate totals
  try {
    const totals = await recalcTotals(proposal_id);
    return res.status(201).json({ success: true, item: insert.data[0], totals });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 5️⃣ Update a proposal item
// =========================
router.put('/items/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity, unit_price, description, show_on_proposal } = req.body;

  const { data, error } = await supabase
    .from('proposal_items')
    .update({ quantity, unit_price, description, show_on_proposal })
    .eq('id', id)
    .select();

  handleResponse(res, { data, error });
});

// =========================
// 6️⃣ Update proposal totals (discount, gratuity, etc.)
// =========================
router.put('/:proposal_id/totals', async (req, res) => {
  const { proposal_id } = req.params;
  const { gratuity_percent, discount_amount, deposit_amount } = req.body;

  const result = await supabase
    .from('proposal_totals')
    .update({ gratuity_percent, discount_amount, deposit_amount })
    .eq('proposal_id', proposal_id)
    .select();

  if (result.error) return handleResponse(res, result);

  try {
    const totals = await recalcTotals(proposal_id);
    return res.status(200).json({ success: true, updated: result.data, recalculated: totals });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 7️⃣ Delete proposal
// =========================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const result = await supabase.from('proposals').delete().eq('id', id);
  handleResponse(res, result);
});

module.exports = router;

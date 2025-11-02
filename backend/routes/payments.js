// backend/routes/payments.js
const express = require('express');
const router = express.Router();
const supabase = require('../../supabaseClient');

// Utility: standard handler
const handleResponse = (res, { data, error }, successCode = 200) => {
  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
  return res.status(successCode).json({ success: true, data });
};

// =========================
// 1️⃣ Get all payments for a proposal
// =========================
router.get('/:proposal_id', async (req, res) => {
  const { proposal_id } = req.params;
  const result = await supabase
    .from('payments')
    .select('id, payment_type, amount, status, method, paid_on')
    .eq('proposal_id', proposal_id)
    .order('paid_on', { ascending: true });
  handleResponse(res, result);
});

// =========================
// 2️⃣ Record new payment
// =========================
router.post('/', async (req, res) => {
  const { proposal_id, payment_type, amount, method, status } = req.body;

  if (!proposal_id || !amount) {
    return res.status(400).json({ success: false, error: 'proposal_id and amount are required.' });
  }

  const result = await supabase
    .from('payments')
    .insert([{ proposal_id, payment_type, amount, method, status }])
    .select();

  // Optional: update proposal_totals.total_paid & remaining_due
  if (result.data && result.data.length > 0) {
    const newPayment = result.data[0];

    // Fetch existing totals
    const totals = await supabase
      .from('proposal_totals')
      .select('subtotal, gratuity_amount, discount_amount, deposit_amount, total_paid, remaining_due')
      .eq('proposal_id', proposal_id)
      .single();

    if (!totals.error && totals.data) {
      const {
        subtotal = 0,
        gratuity_amount = 0,
        discount_amount = 0,
        deposit_amount = 0,
        total_paid = 0
      } = totals.data;

      const newTotalPaid = total_paid + Number(amount);
      const grandTotal = subtotal + gratuity_amount - discount_amount - deposit_amount;
      const newRemainingDue = grandTotal - newTotalPaid;

      await supabase
        .from('proposal_totals')
        .update({
          total_paid: newTotalPaid,
          remaining_due: newRemainingDue < 0 ? 0 : newRemainingDue
        })
        .eq('proposal_id', proposal_id);
    }
  }

  handleResponse(res, result, 201);
});

// =========================
// 3️⃣ Update a payment
// =========================
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, method, status, payment_type } = req.body;

  const result = await supabase
    .from('payments')
    .update({ amount, method, status, payment_type })
    .eq('id', id)
    .select();

  handleResponse(res, result);
});

// =========================
// 4️⃣ Delete a payment
// =========================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const result = await supabase.from('payments').delete().eq('id', id);
  handleResponse(res, result);
});

// =========================
// Export router
// =========================
module.exports = router;

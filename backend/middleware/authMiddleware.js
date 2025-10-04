// backend/middleware/authMiddleware.js
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}

module.exports = { requireLogin };

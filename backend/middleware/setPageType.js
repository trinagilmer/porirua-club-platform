/* eslint-disable no-useless-escape */
// backend/middleware/setPageType.js
module.exports = function setPageType(req, res, next) {
  // If the route path matches /functions/:id or any of its child pages
  if (/^\/functions\/[a-f0-9\-]{8,36}/i.test(req.path)) {
    res.locals.pageType = 'function-detail';
  }
  next();
};

// backend/middleware/setActiveTab.js
module.exports = function setActiveTab(req, res, next) {
  res.locals.activeTab = '';

  // Apply only to function detail routes
  if (/^\/functions\/[a-f0-9\-]{8,36}/i.test(req.path)) {
    if (/\/tasks/i.test(req.path)) {
      res.locals.activeTab = 'tasks';
    } else if (/\/notes/i.test(req.path)) {
      res.locals.activeTab = 'notes';
    } else if (/\/communications/i.test(req.path)) {
      res.locals.activeTab = 'communications';
    } else if (/\/quote/i.test(req.path)) {
      res.locals.activeTab = 'quote';
    } else if (/\/edit/i.test(req.path)) {
      res.locals.activeTab = 'edit';
    } else {
      // default route (/functions/:uuid) = Info tab
      res.locals.activeTab = 'info';
    }
  }

  next();
};


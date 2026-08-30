const AppController = require('./js/modules/app-controller');
const { hydrateIcons } = require('./js/modules/ui/icons');

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  const app = new AppController();
  app.init();

  window.app = app;
});


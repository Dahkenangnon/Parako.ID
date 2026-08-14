document.addEventListener('DOMContentLoaded', () => {
  document
    .querySelectorAll<HTMLElement>('[data-error-action]')
    .forEach(element => {
      element.addEventListener('click', () => {
        if (element.dataset.errorAction === 'back') {
          window.history.back();
        } else if (element.dataset.errorAction === 'reload') {
          window.location.reload();
        }
      });
    });
});

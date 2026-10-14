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

  const countdown = document.querySelector<HTMLElement>(
    '[data-rate-limit-countdown]'
  );
  if (!countdown) return;

  let remaining = Number.parseInt(
    countdown.dataset.rateLimitCountdown ?? '',
    10
  );
  if (!Number.isFinite(remaining) || remaining < 0) return;

  countdown.textContent = String(remaining);
  const timer = window.setInterval(() => {
    remaining = Math.max(remaining - 1, 0);
    countdown.textContent = String(remaining);
    if (remaining === 0) window.clearInterval(timer);
  }, 1_000);
});

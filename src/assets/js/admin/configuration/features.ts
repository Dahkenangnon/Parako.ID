(function () {
  'use strict';

  const toggles = document.querySelectorAll<HTMLInputElement>(
    '[data-provider-toggle]'
  );
  toggles.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const providerId = checkbox.getAttribute('data-provider-toggle');
      if (!providerId) return;
      const credsPanel = document.getElementById(`creds-${providerId}`);
      if (!credsPanel) return;
      if (checkbox.checked) {
        credsPanel.classList.remove('hidden');
      } else {
        credsPanel.classList.add('hidden');
      }
    });
  });

  const maxInput = document.getElementById(
    'options_max_providers'
  ) as HTMLInputElement | null;
  if (maxInput) {
    maxInput.addEventListener('change', function () {
      const val = parseInt(this.value, 10);
      if (this.value !== '' && (isNaN(val) || val < 1 || val > 10)) {
        this.setCustomValidity('Must be between 1 and 10');
        this.reportValidity();
      } else {
        this.setCustomValidity('');
      }
    });
  }
})();

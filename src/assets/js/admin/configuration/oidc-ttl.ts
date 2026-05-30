(function () {
  const ttlInputs = document.querySelectorAll<HTMLInputElement>('.ttl-input');
  ttlInputs.forEach(input => {
    input.addEventListener('change', function () {
      const max = parseInt(this.getAttribute('max') ?? '', 10);
      const val = parseInt(this.value, 10);
      if (this.value !== '' && !isNaN(max)) {
        if (isNaN(val) || val < 1) {
          this.setCustomValidity('Must be at least 1 second');
          this.reportValidity();
        } else if (val > max) {
          this.setCustomValidity(
            `Cannot exceed the system limit of ${max} seconds`
          );
          this.reportValidity();
        } else {
          this.setCustomValidity('');
        }
      } else {
        this.setCustomValidity('');
      }
    });
  });
})();

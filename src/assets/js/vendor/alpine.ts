import Alpine from '@alpinejs/csp';

declare global {
  interface Window {
    Alpine?: typeof Alpine;
  }
}

window.Alpine = Alpine;
Alpine.start();

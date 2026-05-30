import { createIcons, icons } from 'lucide';

declare global {
  interface Window {
    lucide?: { createIcons: () => void };
  }
}

window.lucide = {
  createIcons: () => createIcons({ icons }),
};

document.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
});

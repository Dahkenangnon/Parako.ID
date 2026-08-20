import { createIcons, icons } from 'lucide';

window.lucide = {
  createIcons: () => createIcons({ icons }),
};

document.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
});

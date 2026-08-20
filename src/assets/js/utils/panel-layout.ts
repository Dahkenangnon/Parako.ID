export interface SidebarLayoutElements {
  sidebar: HTMLElement;
  mainContent: HTMLElement;
  lightLogo?: HTMLImageElement | null;
  darkLogo?: HTMLImageElement | null;
}

function setClass(element: HTMLElement, name: string, enabled: boolean): void {
  if (enabled) element.classList.add(name);
  else element.classList.remove(name);
}

function updateLogo(
  logo: HTMLImageElement | null | undefined,
  expanded: boolean
): void {
  if (!logo) return;
  const source = expanded ? logo.dataset.rect : logo.dataset.icon;
  if (source) logo.src = source;
}

export function setSidebarExpanded(
  expanded: boolean,
  elements: SidebarLayoutElements
): void {
  const { sidebar, mainContent, lightLogo, darkLogo } = elements;
  setClass(sidebar, 'sidebar-expanded', expanded);
  setClass(sidebar, 'sidebar-collapsed', !expanded);
  setClass(mainContent, 'main-content-expanded', expanded);
  setClass(mainContent, 'main-content-collapsed', !expanded);
  updateLogo(lightLogo, expanded);
  updateLogo(darkLogo, expanded);
}

export function setMobileSidebarOpen(
  open: boolean,
  sidebar: HTMLElement | null,
  overlay: HTMLElement | null
): void {
  if (!sidebar || !overlay) return;
  setClass(sidebar, 'translate-x-0', open);
  setClass(sidebar, '-translate-x-full', !open);
  setClass(overlay, 'opacity-100', open);
  setClass(overlay, 'visible', open);
  setClass(overlay, 'opacity-0', !open);
  setClass(overlay, 'invisible', !open);
}

export function applyPanelTheme(theme: 'light' | 'dark'): void {
  const dark = theme === 'dark';
  setClass(document.documentElement, 'dark', dark);
  setClass(document.body, 'dark', dark);
}

export function setDropdownOpen(
  open: boolean,
  dropdown: HTMLElement,
  toggle: HTMLElement
): void {
  setClass(dropdown, 'hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
}

export function toggleDropdown(
  dropdown: HTMLElement,
  toggle: HTMLElement
): void {
  setDropdownOpen(dropdown.classList.contains('hidden'), dropdown, toggle);
}

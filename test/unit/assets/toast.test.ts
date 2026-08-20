import { afterEach, describe, expect, it, vi } from 'vitest';

import { showToast } from '../../../src/assets/js/utils/toast.js';

type Listener = () => void;

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public className = '';
  public parentNode: ElementFixture | null = null;
  public textContent = '';
  public type = '';
  private readonly listeners = new Map<string, Listener>();

  public addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, listener);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public remove(): void {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string): void {
    this.listeners.get(name)?.();
  }
}

function setupDom() {
  const body = new ElementFixture();
  const createIcons = vi.fn();
  vi.stubGlobal('window', { lucide: { createIcons } });
  vi.stubGlobal('document', {
    body,
    createElement: vi.fn(() => new ElementFixture()),
  });
  return { body, createIcons };
}

describe('toast service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['error', 'alert', 'assertive', 'bg-red-500', 'alert-circle'],
    ['success', 'status', 'polite', 'bg-green-500', 'check-circle'],
    ['warning', 'status', 'polite', 'bg-amber-500', 'alert-triangle'],
  ] as const)(
    'renders an accessible %s notification',
    (variant, role, live, color, iconName) => {
      vi.useFakeTimers();
      const { body, createIcons } = setupDom();

      showToast('Saved', 'Configuration updated.', variant);

      const toast = body.children[0];
      expect(toast.attributes.get('role')).toBe(role);
      expect(toast.attributes.get('aria-live')).toBe(live);
      expect(toast.className).toContain(color);
      expect(toast.children[0].children[0].attributes.get('data-lucide')).toBe(
        iconName
      );
      const dismiss = toast.children[0].children[2];
      expect(dismiss.type).toBe('button');
      expect(dismiss.attributes.get('aria-label')).toBe(
        'Dismiss Saved notification'
      );
      expect(createIcons).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(5000);
      expect(body.children).toHaveLength(0);
    }
  );

  it('supports explicit dismissal when the icon library is absent', () => {
    vi.useFakeTimers();
    const { body } = setupDom();
    vi.stubGlobal('window', {});

    showToast('Failed', 'Try again.', 'error');
    body.children[0].children[0].children[2].trigger('click');

    expect(body.children).toHaveLength(0);
  });
});

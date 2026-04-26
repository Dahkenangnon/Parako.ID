/**
 * Admin User Activities Module
 *
 * Handles user activities page functionality:
 * - Auto-submit form when filter changes
 * - Tooltip functionality for truncated text
 */
(function () {
  'use strict';

  class UserActivitiesManager {
    private typeSelect: HTMLSelectElement | null = null;
    private limitSelect: HTMLSelectElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.setupEventListeners();
      this.setupTooltips();
    }

    private cacheElements(): void {
      this.typeSelect = document.getElementById(
        'type'
      ) as HTMLSelectElement | null;
      this.limitSelect = document.getElementById(
        'limit'
      ) as HTMLSelectElement | null;
    }

    private setupEventListeners(): void {
      // Auto-submit form when filter changes
      this.typeSelect?.addEventListener('change', () => {
        this.typeSelect?.form?.submit();
      });

      this.limitSelect?.addEventListener('change', () => {
        this.limitSelect?.form?.submit();
      });
    }

    private setupTooltips(): void {
      const elementsWithTitle = document.querySelectorAll('[title]');

      elementsWithTitle.forEach(element => {
        const htmlElement = element as HTMLElement;
        let tooltip: HTMLElement | null = null;

        htmlElement.addEventListener('mouseenter', function () {
          const titleText = this.getAttribute('title');
          if (!titleText) return;

          tooltip = document.createElement('div');
          tooltip.className =
            'absolute z-50 px-2 py-1 text-xs bg-card border border-border pointer-events-none';
          tooltip.textContent = titleText;
          document.body.appendChild(tooltip);

          const rect = this.getBoundingClientRect();
          tooltip.style.left = rect.left + 'px';
          tooltip.style.top = rect.bottom + 5 + 'px';
        });

        htmlElement.addEventListener('mouseleave', function () {
          if (tooltip && tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
            tooltip = null;
          }
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new UserActivitiesManager().initialize();
  });
})();

/**
 * Tooltip Utility
 *
 * Provides enhanced tooltip functionality:
 * - Programmatic tooltip creation
 * - Enhanced native title tooltips
 * - Copy-to-clipboard with tooltip feedback
 * - Truncated text with full tooltip
 */
/* eslint-disable no-undef */
(function () {
  'use strict';

  // Type Definitions

  interface TooltipOptions {
    text: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    delay?: number; // Show delay in ms
    duration?: number; // Auto-hide duration in ms (0 = no auto-hide)
    className?: string; // Additional CSS classes
  }

  const DEFAULT_OPTIONS: Partial<TooltipOptions> = {
    position: 'top',
    delay: 200,
    duration: 0,
  };

  const TOOLTIP_BASE_CLASS =
    'fixed z-50 px-2 py-1 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded shadow-lg pointer-events-none transition-opacity duration-150';

  // Tooltip Element Management

  let activeTooltip: HTMLElement | null = null;
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Create tooltip element
   */
  function createTooltipElement(options: TooltipOptions): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = `${TOOLTIP_BASE_CLASS} opacity-0 ${options.className || ''}`;
    tooltip.textContent = options.text;
    tooltip.setAttribute('role', 'tooltip');
    return tooltip;
  }

  /**
   * Position tooltip relative to target element
   */
  function positionTooltip(
    tooltip: HTMLElement,
    target: HTMLElement,
    position: TooltipOptions['position'] = 'top'
  ): void {
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const gap = 8; // Gap between tooltip and target

    let top: number;
    let left: number;

    switch (position) {
      case 'bottom':
        top = targetRect.bottom + gap;
        left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
        left = targetRect.left - tooltipRect.width - gap;
        break;
      case 'right':
        top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
        left = targetRect.right + gap;
        break;
      case 'top':
      default:
        top = targetRect.top - tooltipRect.height - gap;
        left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
        break;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < 8) left = 8;
    if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }
    if (top < 8) top = targetRect.bottom + gap; // Flip to bottom if no room on top
    if (top + tooltipRect.height > viewportHeight - 8) {
      top = targetRect.top - tooltipRect.height - gap; // Flip to top if no room on bottom
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  /**
   * Show tooltip
   */
  function showTooltip(target: HTMLElement, options: TooltipOptions): void {
    hideTooltip();

    const tooltip = createTooltipElement(options);
    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    // Position after adding to DOM (so we can measure)
    requestAnimationFrame(() => {
      positionTooltip(tooltip, target, options.position);
      tooltip.classList.remove('opacity-0');
      tooltip.classList.add('opacity-100');
    });

    // Auto-hide if duration is set
    if (options.duration && options.duration > 0) {
      hideTimeout = setTimeout(() => {
        hideTooltip();
      }, options.duration);
    }
  }

  /**
   * Hide tooltip
   */
  function hideTooltip(): void {
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    if (activeTooltip) {
      activeTooltip.classList.remove('opacity-100');
      activeTooltip.classList.add('opacity-0');

      const tooltipToRemove = activeTooltip;
      setTimeout(() => {
        tooltipToRemove.remove();
      }, 150);

      activeTooltip = null;
    }
  }

  // Public API

  /**
   * Show a tooltip on an element
   *
   * @param target - Target element or selector
   * @param options - Tooltip options
   */
  function show(
    target: HTMLElement | string,
    options: TooltipOptions | string
  ): void {
    const element =
      typeof target === 'string'
        ? document.querySelector<HTMLElement>(target)
        : target;

    if (!element) {
      console.warn('[Tooltip] Target element not found');
      return;
    }

    const opts: TooltipOptions =
      typeof options === 'string'
        ? ({ ...DEFAULT_OPTIONS, text: options } as TooltipOptions)
        : { ...DEFAULT_OPTIONS, ...options };

    if (opts.delay && opts.delay > 0) {
      showTimeout = setTimeout(() => {
        showTooltip(element, opts);
      }, opts.delay);
    } else {
      showTooltip(element, opts);
    }
  }

  /**
   * Hide the active tooltip
   */
  function hide(): void {
    hideTooltip();
  }

  /**
   * Show a temporary tooltip (auto-hides after duration)
   *
   * @param target - Target element or selector
   * @param text - Tooltip text
   * @param duration - Duration in ms before auto-hide (default: 2000)
   */
  function showTemporary(
    target: HTMLElement | string,
    text: string,
    duration: number = 2000
  ): void {
    show(target, { text, duration, delay: 0 });
  }

  /**
   * Copy text to clipboard and show feedback tooltip
   *
   * @param text - Text to copy
   * @param target - Element to show tooltip on
   * @param successMessage - Message to show on success (default: 'Copied!')
   * @param errorMessage - Message to show on error (default: 'Failed to copy')
   */
  async function copyWithFeedback(
    text: string,
    target: HTMLElement | string,
    successMessage: string = 'Copied!',
    errorMessage: string = 'Failed to copy'
  ): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      showTemporary(target, successMessage, 1500);
      return true;
    } catch (error) {
      console.error('[Tooltip] Copy failed:', error);
      showTemporary(target, errorMessage, 2000);
      return false;
    }
  }

  /**
   * Initialize tooltip behavior on elements with data-tooltip attribute
   * Elements should have: data-tooltip="Tooltip text"
   * Optional: data-tooltip-position="top|bottom|left|right"
   */
  function initDataTooltips(): void {
    const elements = document.querySelectorAll<HTMLElement>('[data-tooltip]');

    elements.forEach(element => {
      const text = element.getAttribute('data-tooltip');
      const position =
        (element.getAttribute(
          'data-tooltip-position'
        ) as TooltipOptions['position']) || 'top';

      if (!text) return;

      element.addEventListener('mouseenter', () => {
        show(element, { text, position, delay: 200 });
      });

      element.addEventListener('mouseleave', () => {
        hide();
      });

      element.addEventListener('focus', () => {
        show(element, { text, position, delay: 0 });
      });

      element.addEventListener('blur', () => {
        hide();
      });
    });
  }

  /**
   * Setup truncated text elements with full-text tooltip
   * Elements should have: data-truncate-tooltip="true"
   * The element's textContent will be used as the tooltip
   */
  function initTruncateTooltips(): void {
    const elements = document.querySelectorAll<HTMLElement>(
      '[data-truncate-tooltip]'
    );

    elements.forEach(element => {
      const fullText = element.textContent?.trim() || '';

      // Only show tooltip if text is actually truncated
      const isOverflowing = element.scrollWidth > element.clientWidth;

      if (isOverflowing && fullText) {
        element.addEventListener('mouseenter', () => {
          // Re-check if still overflowing
          if (element.scrollWidth > element.clientWidth) {
            show(element, { text: fullText, position: 'top', delay: 300 });
          }
        });

        element.addEventListener('mouseleave', () => {
          hide();
        });
      }
    });
  }

  /**
   * Initialize all tooltip functionality on page load
   */
  function init(): void {
    initDataTooltips();
    initTruncateTooltips();
  }

  const Tooltip = {
    show,
    hide,
    showTemporary,
    copyWithFeedback,
    initDataTooltips,
    initTruncateTooltips,
    init,
  };

  if (typeof window !== 'undefined') {
    (window as any).Tooltip = Tooltip;
  }

  // Auto-initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);
})();

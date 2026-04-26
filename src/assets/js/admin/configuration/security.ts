/**
 * Admin Configuration Security Module
 *
 * Client-side enhancements for the tenant security configuration page:
 * - Textarea auto-resize for multi-line fields (high_risk_countries, domains_whitelist, etc.)
 *
 * Used by: security section
 */
(function () {
  'use strict';

  /**
   * Auto-resize a textarea to fit its content.
   */
  function autoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  /**
   * Set up auto-resize for all textareas in the config form.
   */
  function setupTextareaAutoResize(): void {
    const form = document.getElementById('config-form');
    if (!form) return;

    const textareas = form.querySelectorAll<HTMLTextAreaElement>('textarea');
    for (const textarea of textareas) {
      autoResize(textarea);
      textarea.addEventListener('input', function () {
        autoResize(textarea);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', setupTextareaAutoResize);
})();

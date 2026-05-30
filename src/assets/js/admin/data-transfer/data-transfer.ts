/**
 * Admin Data Transfer Module
 *
 * Client-side file parsing, preview, and SSE-based import progress.
 * Handles CSV (PapaParse) and JSON file formats.
 */
import Papa from 'papaparse';

interface EntityConfig {
  entityId: string;
  format: 'csv' | 'json';
  hasImport: boolean;
  hasExport: boolean;
  importColumns: Array<{
    field: string;
    header: string;
    required?: boolean;
    aliases?: string[];
  }>;
}

interface DialogApi {
  showAlert: (
    title: string,
    message: string,
    options?: { variant?: string }
  ) => Promise<void>;
  showConfirm: (
    title: string,
    message: string,
    options?: {
      variant?: string;
      confirmText?: string;
      cancelText?: string;
    }
  ) => Promise<boolean>;
}

interface LucideApi {
  createIcons: () => void;
}

interface WindowWithApis {
  dialog: DialogApi;
  lucide?: LucideApi;
  __ENTITY_CONFIG__?: EntityConfig;
}

interface ParsedRow {
  [key: string]: unknown;
}

interface ColumnMatch {
  expected: string;
  header: string;
  matchedTo: string | null;
  required: boolean;
}

interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  errors: Array<{
    rowNumber: number;
    error: string;
    fields: Record<string, string>;
  }>;
  durationMs: number;
}

(function () {
  'use strict';

  const maybeConfig = (window as unknown as WindowWithApis).__ENTITY_CONFIG__;
  if (!maybeConfig) return;
  const config: EntityConfig = maybeConfig;

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_PREVIEW_ROWS = 5;

  let parsedRows: ParsedRow[] = [];
  let columnMatches: ColumnMatch[] = [];

  // ── Element refs ───────────────────────────────────────────────────────

  const fileInput = document.getElementById(
    'import-file-input'
  ) as HTMLInputElement | null;
  const previewArea = document.getElementById('preview-area');
  const previewTotal = document.getElementById('preview-total');
  const previewValid = document.getElementById('preview-valid');
  const previewErrors = document.getElementById('preview-errors');
  const columnMatchArea = document.getElementById('column-match-area');
  const columnMatchBody = document.getElementById('column-match-body');
  const sampleHeader = document.getElementById('sample-header');
  const sampleBody = document.getElementById('sample-body');
  const validationErrors = document.getElementById('validation-errors');
  const errorList = document.getElementById('error-list');
  const confirmImportBtn = document.getElementById(
    'confirm-import-btn'
  ) as HTMLButtonElement | null;
  const cancelPreviewBtn = document.getElementById('cancel-preview-btn');
  const progressArea = document.getElementById('progress-area');
  const progressBar = document.getElementById('progress-bar');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatus = document.getElementById('progress-status');
  const resultArea = document.getElementById('result-area');
  const resultSummary = document.getElementById('result-summary');
  const resultErrors = document.getElementById('result-errors');
  const resultErrorBody = document.getElementById('result-error-body');
  const newImportBtn = document.getElementById('new-import-btn');
  const includeSecretsCheckbox = document.getElementById(
    'include-secrets-checkbox'
  ) as HTMLInputElement | null;
  const exportBtn = document.getElementById(
    'export-btn'
  ) as HTMLButtonElement | null;

  const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  const importPanel = document.getElementById('import-panel');
  const exportPanel = document.getElementById('export-panel');

  // ── Helpers ────────────────────────────────────────────────────────────

  function getCsrfToken(): string {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta?.getAttribute('content') || '';
  }

  function clearElement(el: HTMLElement): void {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function createTextEl(
    tag: string,
    text: string,
    className?: string
  ): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  // ── Tab Navigation ─────────────────────────────────────────────────────

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabButtons.forEach(b => {
        const isActive = b.dataset.tab === tab;
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        b.classList.toggle('border-primary', isActive);
        b.classList.toggle('text-primary', isActive);
        b.classList.toggle('border-transparent', !isActive);
        b.classList.toggle('text-muted-foreground', !isActive);
      });

      if (importPanel) importPanel.classList.toggle('hidden', tab !== 'import');
      if (exportPanel) exportPanel.classList.toggle('hidden', tab !== 'export');
    });
  });

  // ── File Selection ─────────────────────────────────────────────────────

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const dialog = (window as unknown as WindowWithApis).dialog;

    if (file.size > MAX_FILE_SIZE) {
      await dialog.showAlert(
        'File Too Large',
        `Maximum file size is 10MB. Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
        { variant: 'error' }
      );
      fileInput.value = '';
      return;
    }

    const ext = file.name.toLowerCase().split('.').pop();
    const expectedExt = config.format === 'csv' ? 'csv' : 'json';
    if (ext !== expectedExt) {
      await dialog.showAlert(
        'Invalid File Type',
        `Expected .${expectedExt} file.`,
        { variant: 'error' }
      );
      fileInput.value = '';
      return;
    }

    const text = await file.text();

    if (config.format === 'csv') {
      parseCsvFile(text);
    } else {
      parseJsonFile(text);
    }
  });

  // ── CSV Parsing ────────────────────────────────────────────────────────

  function parseCsvFile(text: string): void {
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    if (result.errors.length > 0 && result.data.length === 0) {
      showParseError(
        'CSV parsing failed: ' +
          result.errors.map((e: Papa.ParseError) => e.message).join(', ')
      );
      return;
    }

    parsedRows = result.data as ParsedRow[];
    const csvHeaders = result.meta.fields || [];

    columnMatches = matchColumns(csvHeaders);
    showPreview(csvHeaders);
  }

  function matchColumns(csvHeaders: string[]): ColumnMatch[] {
    const matches: ColumnMatch[] = [];
    const lowerHeaders = csvHeaders.map(h => h.toLowerCase().trim());

    for (const col of config.importColumns) {
      const candidates = [
        col.field.toLowerCase(),
        col.header.toLowerCase(),
        ...(col.aliases || []).map(a => a.toLowerCase()),
      ];

      let matchedTo: string | null = null;
      for (const candidate of candidates) {
        const idx = lowerHeaders.indexOf(candidate);
        if (idx !== -1) {
          matchedTo = csvHeaders[idx];
          break;
        }
      }

      matches.push({
        expected: col.header,
        header: col.field,
        matchedTo,
        required: col.required || false,
      });
    }

    return matches;
  }

  // ── JSON Parsing ───────────────────────────────────────────────────────

  function parseJsonFile(text: string): void {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      showParseError('Invalid JSON file. Please check the file format.');
      return;
    }

    if (!Array.isArray(data)) {
      showParseError('JSON file must contain an array of objects.');
      return;
    }

    if (data.length === 0) {
      showParseError('JSON file is empty.');
      return;
    }

    parsedRows = data as ParsedRow[];
    columnMatches = [];
    showPreview(Object.keys(parsedRows[0] || {}));
  }

  // ── Preview Rendering ──────────────────────────────────────────────────

  function showParseError(message: string): void {
    const dialog = (window as unknown as WindowWithApis).dialog;
    dialog.showAlert('Parse Error', message, { variant: 'error' });
    resetPreview();
  }

  function showPreview(headers: string[]): void {
    if (!previewArea) return;

    const errors: string[] = [];
    if (config.format === 'csv') {
      for (const match of columnMatches) {
        if (match.required && !match.matchedTo) {
          errors.push(`Required column "${match.expected}" not found in file.`);
        }
      }
    }

    const requiredFields = config.importColumns
      .filter(c => c.required)
      .map(c => c.field);

    let validCount = 0;
    let errorCount = 0;

    for (const row of parsedRows) {
      const mappedRow =
        config.format === 'csv' ? mapCsvRow(row) : (row as ParsedRow);
      const hasRequired = requiredFields.every(
        f => mappedRow[f] !== undefined && String(mappedRow[f]).trim() !== ''
      );
      if (hasRequired) {
        validCount++;
      } else {
        errorCount++;
      }
    }

    if (previewTotal)
      previewTotal.textContent = `${parsedRows.length} total rows`;
    if (previewValid) previewValid.textContent = `${validCount} valid`;
    if (previewErrors) previewErrors.textContent = `${errorCount} errors`;

    // Show column matching (CSV only)
    if (config.format === 'csv' && columnMatchArea && columnMatchBody) {
      clearElement(columnMatchBody);

      for (const match of columnMatches) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-border';

        const tdExpected = document.createElement('td');
        tdExpected.className = 'py-2 pr-4';
        tdExpected.textContent = match.expected;
        if (match.required) {
          const badge = createTextEl(
            'span',
            '*',
            'text-destructive ml-1 font-bold'
          );
          tdExpected.appendChild(badge);
        }
        tr.appendChild(tdExpected);

        const tdMatched = document.createElement('td');
        tdMatched.className = 'py-2 pr-4';
        tdMatched.textContent = match.matchedTo || '—';
        if (!match.matchedTo) {
          tdMatched.classList.add('text-muted-foreground', 'italic');
        }
        tr.appendChild(tdMatched);

        const tdStatus = document.createElement('td');
        tdStatus.className = 'py-2';
        if (match.matchedTo) {
          tdStatus.appendChild(
            createTextEl(
              'span',
              'Matched',
              'text-green-600 text-xs font-medium'
            )
          );
        } else if (match.required) {
          tdStatus.appendChild(
            createTextEl(
              'span',
              'Missing',
              'text-destructive text-xs font-medium'
            )
          );
        } else {
          tdStatus.appendChild(
            createTextEl(
              'span',
              'Optional',
              'text-muted-foreground text-xs font-medium'
            )
          );
        }
        tr.appendChild(tdStatus);

        columnMatchBody.appendChild(tr);
      }

      columnMatchArea.classList.remove('hidden');
    }

    if (sampleHeader && sampleBody) {
      clearElement(sampleHeader);
      clearElement(sampleBody);

      const displayHeaders =
        config.format === 'csv'
          ? columnMatches.filter(m => m.matchedTo).map(m => m.expected)
          : headers.slice(0, 10);

      const headerRow = document.createElement('tr');
      headerRow.className = 'text-left';
      for (const h of displayHeaders) {
        const th = document.createElement('th');
        th.className = 'py-2 pr-4 font-medium text-muted-foreground';
        th.textContent = h;
        headerRow.appendChild(th);
      }
      sampleHeader.appendChild(headerRow);

      const sampleRows = parsedRows.slice(0, MAX_PREVIEW_ROWS);
      for (const row of sampleRows) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-border';

        const mappedRow =
          config.format === 'csv' ? mapCsvRow(row) : (row as ParsedRow);

        const displayKeys =
          config.format === 'csv'
            ? columnMatches.filter(m => m.matchedTo).map(m => m.header)
            : headers.slice(0, 10);

        for (const key of displayKeys) {
          const td = document.createElement('td');
          td.className =
            'py-2 pr-4 text-muted-foreground truncate max-w-[200px]';
          const val = mappedRow[key];
          td.textContent = val != null ? String(val) : '';
          tr.appendChild(td);
        }

        sampleBody.appendChild(tr);
      }
    }

    if (errors.length > 0 && validationErrors && errorList) {
      clearElement(errorList);
      for (const err of errors) {
        const li = document.createElement('li');
        li.textContent = err;
        errorList.appendChild(li);
      }
      validationErrors.classList.remove('hidden');
    } else {
      validationErrors?.classList.add('hidden');
    }

    // Enable/disable confirm button
    if (confirmImportBtn) {
      const hasRequiredColumnsMissing = columnMatches.some(
        m => m.required && !m.matchedTo
      );
      confirmImportBtn.disabled =
        validCount === 0 ||
        (config.format === 'csv' && hasRequiredColumnsMissing);
    }

    previewArea.classList.remove('hidden');
  }

  function mapCsvRow(row: ParsedRow): ParsedRow {
    const mapped: ParsedRow = {};
    for (const match of columnMatches) {
      if (match.matchedTo) {
        mapped[match.header] = row[match.matchedTo];
      }
    }
    return mapped;
  }

  function resetPreview(): void {
    parsedRows = [];
    columnMatches = [];
    previewArea?.classList.add('hidden');
    progressArea?.classList.add('hidden');
    resultArea?.classList.add('hidden');
    if (confirmImportBtn) confirmImportBtn.disabled = true;
    if (fileInput) fileInput.value = '';
  }

  // ── Cancel Preview ─────────────────────────────────────────────────────

  cancelPreviewBtn?.addEventListener('click', () => {
    resetPreview();
  });

  // ── New Import ─────────────────────────────────────────────────────────

  newImportBtn?.addEventListener('click', () => {
    resetPreview();
  });

  // ── Confirm Import ─────────────────────────────────────────────────────

  confirmImportBtn?.addEventListener('click', async () => {
    if (parsedRows.length === 0) return;

    const rows =
      config.format === 'csv'
        ? parsedRows.map(row => mapCsvRow(row))
        : parsedRows;

    // Disable button to prevent double-submit
    confirmImportBtn.disabled = true;

    try {
      // POST rows to server — server validates synchronously, then enqueues if valid
      const res = await fetch(
        `/admin/data-transfer/${config.entityId}/import`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify({ rows }),
        }
      );

      if (!res.ok) {
        const errData = await res
          .json()
          .catch(() => ({ error: 'Import failed' }));
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      const data = await res.json();

      // Phase 1 response: validation failed — show errors immediately
      if (data.phase === 'validation' && !data.valid) {
        confirmImportBtn.disabled = false;
        showResult({
          totalRows: data.totalRows,
          successCount: 0,
          errorCount: data.errors.length,
          skippedCount: data.skippedCount ?? 0,
          errors: data.errors,
          durationMs: 0,
        });
        previewArea?.classList.add('hidden');
        return;
      }

      // Phase 2 response: all valid, job enqueued — track insert progress
      if (data.phase === 'enqueued' && data.jobId) {
        previewArea?.classList.add('hidden');
        showProgress();
        trackImportJob(data.jobId);
        return;
      }

      throw new Error('Unexpected server response');
    } catch (err) {
      confirmImportBtn.disabled = false;
      const dialog = (window as unknown as WindowWithApis).dialog;
      await dialog.showAlert(
        'Import Error',
        err instanceof Error ? err.message : 'Failed to start import',
        { variant: 'error' }
      );
    }
  });

  /**
   * Track the async insert job via SSE with polling fallback.
   * Uses state tracking to prevent race conditions between EventSource
   * events and onerror handler.
   */
  function trackImportJob(jobId: string): void {
    let resultHandled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource | null = null;

    function handleResult(result: ImportResult): void {
      if (resultHandled) return;
      resultHandled = true;
      cleanup();
      hideProgress();
      showResult(result);
    }

    function handleError(message: string): void {
      if (resultHandled) return;
      resultHandled = true;
      cleanup();
      hideProgress();
      showImportError(message);
    }

    function cleanup(): void {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    }

    // Polling fallback — checks job status via regular HTTP
    async function pollJobStatus(): Promise<void> {
      if (resultHandled) return;
      try {
        const res = await fetch(
          `/admin/data-transfer/${config.entityId}/import/${jobId}/status`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (data.state === 'completed' && data.result) {
          handleResult(data.result as ImportResult);
        } else if (data.state === 'failed') {
          handleError(data.error || 'Import failed');
        } else if (typeof data.progress === 'number') {
          updateProgress(data.progress);
        }
      } catch {
        // Polling errors are non-fatal; will retry on next interval
      }
    }

    eventSource = new EventSource(
      `/admin/data-transfer/${config.entityId}/import/${jobId}/progress`
    );

    eventSource.addEventListener('progress', (e: MessageEvent) => {
      if (resultHandled) return;
      try {
        const data = JSON.parse(e.data);
        updateProgress(data.progress || 0);
      } catch {}
    });

    eventSource.addEventListener('completed', (e: MessageEvent) => {
      try {
        const result: ImportResult = JSON.parse(e.data);
        handleResult(result);
      } catch {
        // SSE data parse failed — fall through to polling
        if (!resultHandled) {
          pollJobStatus();
        }
      }
    });

    eventSource.addEventListener('failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        handleError(data.error || 'Import failed');
      } catch {
        handleError('Import failed');
      }
    });

    eventSource.addEventListener('timeout', () => {
      handleError(
        'Import timed out. Check the admin activity log for results.'
      );
    });

    // SSE onerror: only act if result wasn't already handled
    eventSource.onerror = () => {
      if (resultHandled) return;
      // Don't show error immediately — start polling fallback instead
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (!pollTimer) {
        pollTimer = setInterval(pollJobStatus, 2000);
        pollJobStatus(); // Immediate first poll
      }
    };

    // Safety fallback: start polling after 3s regardless, in case SSE never connects
    fallbackTimer = setTimeout(() => {
      if (resultHandled || pollTimer) return;
      pollTimer = setInterval(pollJobStatus, 2000);
      pollJobStatus();
    }, 3000);
  }

  // ── Progress UI ────────────────────────────────────────────────────────

  function showProgress(): void {
    progressArea?.classList.remove('hidden');
    updateProgress(0);
  }

  function hideProgress(): void {
    progressArea?.classList.add('hidden');
  }

  function updateProgress(percent: number): void {
    const clamped = Math.min(100, Math.max(0, percent));
    if (progressBar) progressBar.style.width = `${clamped}%`;
    if (progressPercent) progressPercent.textContent = `${clamped}%`;
    if (progressStatus) {
      progressStatus.textContent =
        clamped >= 100 ? 'Finalizing...' : `Processing... ${clamped}%`;
    }
  }

  // ── Result Display ─────────────────────────────────────────────────────

  function showResult(result: ImportResult): void {
    if (!resultArea || !resultSummary) return;

    clearElement(resultSummary);

    const hasErrors = result.errorCount > 0;
    const titleText = hasErrors
      ? 'Import Completed with Errors'
      : 'Import Completed Successfully';
    const titleClass = hasErrors ? 'text-amber-600' : 'text-green-600';
    resultSummary.appendChild(
      createTextEl('h3', titleText, `font-medium ${titleClass}`)
    );

    const statsDiv = document.createElement('div');
    statsDiv.className = 'flex flex-wrap gap-4 text-sm';

    const statItems = [
      { label: 'Total Rows', value: String(result.totalRows), cls: '' },
      {
        label: 'Imported',
        value: String(result.successCount),
        cls: 'text-green-600',
      },
      {
        label: 'Errors',
        value: String(result.errorCount),
        cls: result.errorCount > 0 ? 'text-destructive' : '',
      },
      {
        label: 'Skipped',
        value: String(result.skippedCount),
        cls: result.skippedCount > 0 ? 'text-amber-600' : '',
      },
      {
        label: 'Duration',
        value: `${(result.durationMs / 1000).toFixed(1)}s`,
        cls: 'text-muted-foreground',
      },
    ];

    for (const stat of statItems) {
      const span = document.createElement('span');
      const labelEl = createTextEl(
        'span',
        `${stat.label}: `,
        'text-muted-foreground'
      );
      const valueEl = createTextEl(
        'span',
        stat.value,
        `font-medium ${stat.cls}`
      );
      span.appendChild(labelEl);
      span.appendChild(valueEl);
      statsDiv.appendChild(span);
    }

    resultSummary.appendChild(statsDiv);

    if (result.errors.length > 0 && resultErrors && resultErrorBody) {
      clearElement(resultErrorBody);

      for (const err of result.errors) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-destructive/20';

        const tdRow = document.createElement('td');
        tdRow.className = 'py-2 pr-4';
        tdRow.textContent = String(err.rowNumber);
        tr.appendChild(tdRow);

        const tdError = document.createElement('td');
        tdError.className = 'py-2 pr-4';
        tdError.textContent = err.error;
        tr.appendChild(tdError);

        const tdFields = document.createElement('td');
        tdFields.className = 'py-2';
        const fieldEntries = Object.entries(err.fields || {});
        tdFields.textContent =
          fieldEntries.length > 0
            ? fieldEntries.map(([k, v]) => `${k}: ${v}`).join(', ')
            : '—';
        tr.appendChild(tdFields);

        resultErrorBody.appendChild(tr);
      }

      resultErrors.classList.remove('hidden');
    } else {
      resultErrors?.classList.add('hidden');
    }

    resultArea.classList.remove('hidden');
  }

  function showImportError(message: string): void {
    const dialog = (window as unknown as WindowWithApis).dialog;
    dialog.showAlert('Import Failed', message, { variant: 'error' });

    if (resultArea && resultSummary) {
      clearElement(resultSummary);
      resultSummary.appendChild(
        createTextEl('h3', 'Import Failed', 'font-medium text-destructive')
      );
      resultSummary.appendChild(
        createTextEl('p', message, 'text-sm text-muted-foreground')
      );
      resultErrors?.classList.add('hidden');
      resultArea.classList.remove('hidden');
    }
  }

  // ── Export with Secrets Confirmation ────────────────────────────────────

  const exportForm = exportBtn?.closest('form');
  exportForm?.addEventListener('submit', async e => {
    if (!includeSecretsCheckbox?.checked) return;

    e.preventDefault();
    const dialog = (window as unknown as WindowWithApis).dialog;
    const confirmed = await dialog.showConfirm(
      'Export Secrets',
      'You are about to export sensitive internal data (password hashes, client secrets).\n\nThis export will be audit logged. Handle the file securely.\n\nContinue?',
      {
        variant: 'warning',
        confirmText: 'Export with Secrets',
        cancelText: 'Cancel',
      }
    );

    if (confirmed) {
      exportForm.submit();
    }
  });
})();

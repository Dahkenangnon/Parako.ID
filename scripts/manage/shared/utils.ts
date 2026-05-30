// SHARED UTILITIES FOR PARAKO.ID MANAGEMENT SCRIPTS

import chalk from 'chalk';
import {
  BoxDrawing,
  TableOptions,
  ExecuteCommandResult,
  ConfigObject,
} from './types.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import rootDir from './file.js';

// Re-export logger for convenience
export { log } from './logger.js';

export function getPackageInfo(): any {
  let packageInfo: any = {};
  try {
    packageInfo = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
    );
  } catch {
    packageInfo = {
      name: 'parako.id',
      version: '0.0.1',
      description: 'Modern, secure, and easy-to-use OIDC/OAuth2 Provider',
      homepage: 'https://parako.id',
      repository: { url: 'https://github.com/Dahkenangnon/Parako.ID' },
      author: {
        name: 'Justin Dah-kenangnon',
        email: 'dah.kenangnon@gmail.com',
      },
    };
  }

  return packageInfo;
}

// BOX DRAWING CONSTANTS

/**
 * Box drawing characters for console output
 */
export const BOX_DRAWING: BoxDrawing = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
  teeUp: '┴',
  teeDown: '┬',
  teeLeft: '┤',
  teeRight: '├',
};

// TEXT FORMATTING UTILITIES

/**
 * Remove ANSI escape codes from string
 */
export function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

/**
 * Truncate text with ellipsis if it exceeds maxLength
 */
export function truncateText(text: string, maxLength: number): string {
  const cleanText = stripAnsi(text);
  if (cleanText.length <= maxLength) {
    return text;
  }

  let visibleChars = 0;
  let cutIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\u001b' || char === '\u009b') {
      const ansiMatch = text
        .slice(i)
        .match(
          /^[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/
        );
      if (ansiMatch) {
        i += ansiMatch[0].length - 1; // -1 because loop will increment
        continue;
      }
    }

    visibleChars++;
    if (visibleChars >= maxLength - 3) {
      cutIndex = i;
      break;
    }
  }

  return text.slice(0, cutIndex) + chalk.dim('...');
}

/**
 * Wrap text to fit within specified width, handling ANSI codes
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const cleanText = stripAnsi(text);

  if (cleanText.length <= maxWidth) {
    return [text];
  }

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  let currentCleanLength = 0;

  for (const word of words) {
    const cleanWord = stripAnsi(word);
    const spaceNeeded = currentCleanLength > 0 ? 1 : 0; // Space before word

    if (currentCleanLength + spaceNeeded + cleanWord.length <= maxWidth) {
      if (currentLine) {
        currentLine += ` ${word}`;
        currentCleanLength += 1 + cleanWord.length;
      } else {
        currentLine = word;
        currentCleanLength = cleanWord.length;
      }
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }

      if (cleanWord.length > maxWidth) {
        lines.push(truncateText(word, maxWidth));
        currentLine = '';
        currentCleanLength = 0;
      } else {
        currentLine = word;
        currentCleanLength = cleanWord.length;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

// CONSOLE OUTPUT UTILITIES

/**
 * Create a beautiful bordered box with content and text wrapping support
 */
export function createBox(content: string[], width: number = 80): string {
  const lines: string[] = [];

  const boxWidth = Math.max(40, Math.min(width, 120));
  const contentWidth = boxWidth - 4; // Account for borders and padding

  lines.push(
    chalk.cyan(
      BOX_DRAWING.topLeft +
        BOX_DRAWING.horizontal.repeat(boxWidth - 2) +
        BOX_DRAWING.topRight
    )
  );

  content.forEach(line => {
    if (line === '') {
      lines.push(
        chalk.cyan(BOX_DRAWING.vertical) +
          ' '.repeat(boxWidth - 2) +
          chalk.cyan(BOX_DRAWING.vertical)
      );
    } else {
      const wrappedLines = wrapText(line, contentWidth);
      wrappedLines.forEach(wrappedLine => {
        const cleanLine = stripAnsi(wrappedLine);
        const padding = Math.max(0, contentWidth - cleanLine.length);
        lines.push(
          `${chalk.cyan(BOX_DRAWING.vertical)} ${wrappedLine}${' '.repeat(
            padding
          )} ${chalk.cyan(BOX_DRAWING.vertical)}`
        );
      });
    }
  });

  lines.push(
    chalk.cyan(
      BOX_DRAWING.bottomLeft +
        BOX_DRAWING.horizontal.repeat(boxWidth - 2) +
        BOX_DRAWING.bottomRight
    )
  );

  return lines.join('\n');
}

/**
 * Create a beautiful table for displaying information with robust width handling
 */
export function createTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {}
): string {
  const { width = 110, colors = true, maxColumnWidth = 25 } = options;
  const numCols = headers.length;

  if (numCols === 0) return '';

  const borderWidth = numCols + 1; // vertical borders
  const paddingWidth = numCols * 2; // 1 space on each side of content
  const availableWidth = Math.max(40, width - borderWidth - paddingWidth);

  const baseColWidth = Math.floor(availableWidth / numCols);
  const maxColWidth = Math.min(maxColumnWidth, baseColWidth);

  const colWidths: number[] = [];

  // First pass: calculate required widths for headers and content
  headers.forEach((header, i) => {
    const headerLength = stripAnsi(header).length;
    const maxContentLength = Math.max(
      headerLength,
      ...rows.map(row => {
        const cell = row[i] || '';
        return stripAnsi(cell).length;
      })
    );

    colWidths[i] = Math.min(
      Math.max(8, maxContentLength + 2), // Minimum 8 chars, plus padding
      maxColWidth // Maximum allowed width
    );
  });

  // Second pass: distribute remaining width if we have space
  const usedWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const remainingWidth = availableWidth - usedWidth;

  if (remainingWidth > 0) {
    const widthPerCol = Math.floor(remainingWidth / numCols);
    colWidths.forEach((width, i) => {
      colWidths[i] = Math.min(width + widthPerCol, maxColumnWidth);
    });
  }

  const lines: string[] = [];

  lines.push(
    chalk.cyan(
      BOX_DRAWING.topLeft +
        colWidths
          .map(w => BOX_DRAWING.horizontal.repeat(w))
          .join(BOX_DRAWING.teeDown) +
        BOX_DRAWING.topRight
    )
  );

  const headerLine = headers
    .map((header, i) => {
      const truncatedHeader = truncateText(header, colWidths[i] - 2);
      const content = colors
        ? chalk.bold.yellow(truncatedHeader)
        : truncatedHeader;
      const cleanContent = stripAnsi(content);
      const padding = Math.max(0, colWidths[i] - cleanContent.length);
      return content + ' '.repeat(padding);
    })
    .join(chalk.cyan(BOX_DRAWING.vertical));
  lines.push(
    chalk.cyan(BOX_DRAWING.vertical) +
      headerLine +
      chalk.cyan(BOX_DRAWING.vertical)
  );

  lines.push(
    chalk.cyan(
      BOX_DRAWING.teeRight +
        colWidths
          .map(w => BOX_DRAWING.horizontal.repeat(w))
          .join(BOX_DRAWING.cross) +
        BOX_DRAWING.teeLeft
    )
  );

  rows.forEach(row => {
    const rowLine = row
      .map((cell, i) => {
        const cellContent = cell || '';
        const truncatedCell = truncateText(cellContent, colWidths[i] - 2);
        const cleanCell = stripAnsi(truncatedCell);
        const padding = Math.max(0, colWidths[i] - cleanCell.length);
        return truncatedCell + ' '.repeat(padding);
      })
      .join(chalk.cyan(BOX_DRAWING.vertical));
    lines.push(
      chalk.cyan(BOX_DRAWING.vertical) +
        rowLine +
        chalk.cyan(BOX_DRAWING.vertical)
    );
  });

  lines.push(
    chalk.cyan(
      BOX_DRAWING.bottomLeft +
        colWidths
          .map(w => BOX_DRAWING.horizontal.repeat(w))
          .join(BOX_DRAWING.teeUp) +
        BOX_DRAWING.bottomRight
    )
  );

  return lines.join('\n');
}

// VALIDATION UTILITIES

/**
 * Validate URL format
 */
export function validateUrl(input: string): string | boolean {
  if (!input) return 'URL is required';
  try {
    new URL(input);
    return true;
  } catch {
    return 'Please enter a valid URL';
  }
}

/**
 * Refuse to start an interactive prompt when stdin is not a TTY.
 *
 * Inquirer reads from `process.stdin`; if a CI pipeline or wrapper
 * redirects stdin (e.g. `pnpm client add < /dev/null`), the prompt would
 * block forever waiting for input. Failing fast surfaces the issue
 * instead of hanging the calling process. Reference:
 * https://nodejs.org/api/tty.html#readstreamistty
 */
export function assertInteractiveTty(commandLabel: string): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Refusing to start interactive prompt for "${commandLabel}": ` +
        'stdin is not a TTY. Run from an interactive terminal or pass ' +
        'the required values via flags.'
    );
  }
}

/**
 * Generate a cryptographically secure random hex secret.
 *
 * Uses Node's CSPRNG (`crypto.randomBytes`) — see
 * https://nodejs.org/api/crypto.html#cryptorandombytessize-callback —
 * which is appropriate for tokens, session secrets and other
 * security-sensitive identifiers. `Math.random()` is NOT acceptable for
 * this use case (https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).
 *
 * @param length Number of random bytes; the returned string is `length * 2`
 *               hex characters long (default 32 bytes = 64 hex chars).
 */
export function generateSecureSecret(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

// CONFIG UTILITIES

/**
 * Deep merge utility for configuration objects
 */
export function deepMerge<T extends ConfigObject>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  function mergeRecursive(tgt: ConfigObject, src: ConfigObject): void {
    for (const key in src) {
      // Block prototype pollution vectors
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }

      if (
        src[key] &&
        typeof src[key] === 'object' &&
        !Array.isArray(src[key])
      ) {
        if (
          !tgt[key] ||
          typeof tgt[key] !== 'object' ||
          Array.isArray(tgt[key])
        ) {
          tgt[key] = {};
        }
        mergeRecursive(tgt[key] as ConfigObject, src[key] as ConfigObject);
      } else {
        tgt[key] = src[key];
      }
    }
  }

  mergeRecursive(result, source);
  return result;
}

/**
 * Get configuration value by path (dot notation)
 */
export function getConfigByPath(config: any, path: string): any {
  return path.split('.').reduce((obj, key) => obj?.[key], config);
}

/**
 * Set configuration value by path (dot notation)
 */
export function setConfigByPath(config: any, path: string, value: any): any {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((obj, key) => {
    if (!obj[key] || typeof obj[key] !== 'object') {
      obj[key] = {};
    }
    return obj[key];
  }, config);

  target[lastKey] = value;
  return config;
}

/**
 * Find configuration keys matching a pattern
 */
export function findConfigKeys(
  pattern: string,
  config: any = null,
  prefix: string = ''
): string[] {
  const keys: string[] = [];

  function traverse(obj: any, currentPath: string) {
    for (const key in obj) {
      const fullPath = currentPath ? `${currentPath}.${key}` : key;
      if (fullPath.toLowerCase().includes(pattern.toLowerCase())) {
        keys.push(fullPath);
      }
      if (
        obj[key] &&
        typeof obj[key] === 'object' &&
        !Array.isArray(obj[key])
      ) {
        traverse(obj[key], fullPath);
      }
    }
  }

  traverse(config, prefix);
  return keys;
}

/**
 * Get all configuration keys
 */
export function getAllConfigKeys(
  config: any = null,
  prefix: string = ''
): string[] {
  const keys: string[] = [];

  function traverse(obj: any, currentPath: string) {
    for (const key in obj) {
      const fullPath = currentPath ? `${currentPath}.${key}` : key;
      keys.push(fullPath);
      if (
        obj[key] &&
        typeof obj[key] === 'object' &&
        !Array.isArray(obj[key])
      ) {
        traverse(obj[key], fullPath);
      }
    }
  }

  traverse(config, prefix);
  return keys;
}

// COMMAND EXECUTION UTILITIES

/**
 * Execute a command and return the result
 */
export async function executeCommand(
  command: string,
  args: string[] = []
): Promise<ExecuteCommandResult> {
  return new Promise(resolve => {
    // `shell: false` is mandatory — passing `shell: true` re-introduces a
    // command-injection vector if any caller ever interpolates user input
    // into `command` or `args`. All current callers pass bare executables
    // (`systemctl`, `id`, `which`, `daemon-reload`) which don't need shell
    // expansion. Reference:
    // https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', data => {
      stdout += data.toString();
    });

    child.stderr?.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      resolve({
        code: code || 0,
        stdout,
        stderr,
        success: code === 0,
      });
    });

    child.on('error', error => {
      resolve({
        code: -1,
        stdout,
        stderr: stderr + error.message,
        success: false,
      });
    });
  });
}

// ARRAY UTILITIES

/**
 * Collect array items interactively
 */
export async function collectArrayItems(
  itemLabel: string,
  validator?: (input: string) => string | boolean
): Promise<string[]> {
  const inquirer = await import('inquirer');
  const { log } = await import('./logger.js');
  const items: string[] = [];
  let collecting = true;

  while (collecting) {
    const { item } = await inquirer.default.prompt([
      {
        type: 'input',
        name: 'item',
        message: `Enter ${itemLabel} ${items.length + 1} (press Enter to finish):`,
        validate: (input: string) => {
          if (!input) return true; // Empty to finish
          if (validator) return validator(input);
          return true;
        },
      },
    ]);

    if (!item) {
      collecting = false;
    } else {
      items.push(item);
      log.success(`Added: ${item}`);
    }
  }

  return items;
}

/**
 * Update array field interactively
 */
export async function updateArrayField(
  currentArray: string[],
  itemLabel: string,
  fieldLabel: string,
  validator?: (input: string) => string | boolean
): Promise<string[] | null> {
  const inquirer = await import('inquirer');
  const { log } = await import('./logger.js');

  if (currentArray.length === 0) {
    log.info(`No existing ${fieldLabel} found.`);
    const { addNew } = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'addNew',
        message: `Add new ${fieldLabel}?`,
        default: true,
      },
    ]);

    if (addNew) {
      const newItems = await collectArrayItems(itemLabel, validator);
      if (newItems.length > 0) {
        return newItems;
      }
    }
    return null;
  }

  console.log(chalk.cyan(`\nCurrent ${fieldLabel}:`));
  currentArray.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item}`);
  });

  const { action } = await inquirer.default.prompt([
    {
      type: 'list',
      name: 'action',
      message: `What would you like to do with ${fieldLabel}?`,
      choices: [
        { name: `➕ Add new ${itemLabel.toLowerCase()}`, value: 'add' },
        {
          name: `❌ Remove existing ${itemLabel.toLowerCase()}`,
          value: 'remove',
        },
        { name: `🔄 Replace all ${fieldLabel}`, value: 'replace' },
        { name: '🚫 Cancel', value: 'cancel' },
      ],
    },
  ]);

  if (action === 'cancel') return null;

  switch (action) {
    case 'add': {
      const newItems = await collectArrayItems(itemLabel, validator);
      if (newItems.length > 0) {
        const combined = [...currentArray, ...newItems];
        const unique = [...new Set(combined)]; // Remove duplicates
        log.success(
          `Added ${newItems.length} new ${itemLabel.toLowerCase()}(s)`
        );
        return unique;
      }
      break;
    }

    case 'remove': {
      const { itemsToRemove } = await inquirer.default.prompt([
        {
          type: 'checkbox',
          name: 'itemsToRemove',
          message: `Select ${itemLabel.toLowerCase()}s to remove:`,
          choices: currentArray.map((item, index) => ({
            name: `${index + 1}. ${item}`,
            value: item,
          })),
          validate: (input: string[]) =>
            input.length > 0 ||
            `Please select at least one ${itemLabel.toLowerCase()} to remove`,
        },
      ] as any);

      const remaining = currentArray.filter(
        item => !itemsToRemove.includes(item)
      );
      log.success(
        `Removed ${itemsToRemove.length} ${itemLabel.toLowerCase()}(s)`
      );
      return remaining;
    }

    case 'replace': {
      const { confirmReplace } = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'confirmReplace',
          message: chalk.yellow(`Replace all existing ${fieldLabel}?`),
          default: false,
        },
      ]);

      if (confirmReplace) {
        const replacementItems = await collectArrayItems(itemLabel, validator);
        log.success(`Replaced all ${fieldLabel}`);
        return replacementItems;
      }
      break;
    }
  }

  return null;
}

// FILE SYSTEM UTILITIES

/**
 * Create a backup with timestamp
 */
export async function createBackup(reason: string = 'manual'): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(rootDir, 'runtime/config-backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupName = `backup-${timestamp}-${reason}.json`;
  const backupPath = path.join(backupDir, backupName);

  return backupPath;
}

/**
 * Clean old backup files
 */
export async function cleanOldBackups(): Promise<void> {
  const { log } = await import('./logger.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const backupDir = path.join(rootDir, 'runtime/config-backups');
  if (!fs.existsSync(backupDir)) return;

  const files = fs
    .readdirSync(backupDir)
    .filter((file: string) => file.endsWith('.json'))
    .map((file: string) => ({
      name: file,
      path: path.join(backupDir, file),
      time: fs.statSync(path.join(backupDir, file)).mtime.getTime(),
    }))
    .sort((a: any, b: any) => b.time - a.time);

  // Keep only the 10 most recent backups
  const maxBackups = 10;
  if (files.length > maxBackups) {
    files.slice(maxBackups).forEach((file: any) => {
      try {
        fs.unlinkSync(file.path);
        log.info(`Cleaned old backup: ${file.name}`);
      } catch (error) {
        log.warning(
          `Failed to clean backup ${file.name}: ${(error as Error).message}`
        );
      }
    });
  }
}

// TYPE DETECTION UTILITIES

/**
 * Detect the type of a configuration value
 */
export function detectConfigValueType(
  value: any
): 'array' | 'object' | 'boolean' | 'number' | 'string' | 'null' {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/**
 * Convert string value to appropriate type
 */
export function convertValueType(value: string, _schemaType?: any): any {
  if (value === 'null' || value === 'undefined') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  const num = Number(value);
  if (!isNaN(num) && isFinite(num)) return num;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Common help display for subcommand modules
 * Provides a consistent, beautiful, and production-ready help interface
 */
export function showSubcommandHelp(moduleInfo: {
  name: string;
  icon: string;
  description: string;
  version: string;
  examples: Array<{ command: string; description: string }>;
  features?: Array<{ icon: string; title: string; description: string }>;
  quickStart?: Array<{ command: string; description: string; time?: string }>;
  tips?: string[];
  fileInfo?: { configFile?: string; backupDir?: string; logFile?: string };
}): void {
  console.log('');

  const headerContent = [
    '',
    chalk.bold.cyan(`${moduleInfo.icon} ${moduleInfo.name.toUpperCase()}`),
    '',
    chalk.dim(moduleInfo.description),
    '',
    chalk.dim('Version: ') + chalk.yellow(`v${moduleInfo.version}`),
    '',
  ];

  console.log(createBox(headerContent, 70));
  console.log('');

  // Quick start section (if provided)
  if (moduleInfo.quickStart && moduleInfo.quickStart.length > 0) {
    console.log(chalk.bold.green('🚀 QUICK START'));
    console.log(chalk.dim('━'.repeat(40)));

    const quickStartRows = moduleInfo.quickStart.map(item => [
      chalk.cyan(item.command),
      item.description,
      item.time ? chalk.yellow(item.time) : '',
    ]);

    console.log(
      createTable(['Command', 'Description', 'Time'], quickStartRows, {
        width: 75,
        maxColumnWidth: 25,
      })
    );
    console.log('');
  }

  console.log(chalk.bold.blue('💡 EXAMPLES'));
  console.log(chalk.dim('━'.repeat(40)));

  const exampleRows = moduleInfo.examples.map(item => [
    chalk.cyan(item.command),
    item.description,
  ]);

  console.log(
    createTable(['Command', 'Description'], exampleRows, {
      width: 75,
      maxColumnWidth: 30,
    })
  );
  console.log('');

  // Features section (if provided)
  if (moduleInfo.features && moduleInfo.features.length > 0) {
    console.log(chalk.bold.magenta('✨ FEATURES'));
    console.log(chalk.dim('━'.repeat(40)));

    moduleInfo.features.forEach(feature => {
      console.log(`  ${feature.icon} ${chalk.cyan(feature.title)}`);
      console.log(`    ${chalk.dim(feature.description)}`);
      console.log('');
    });
  }

  // Tips section (if provided)
  if (moduleInfo.tips && moduleInfo.tips.length > 0) {
    console.log(chalk.bold.yellow('💡 TIPS'));
    console.log(chalk.dim('━'.repeat(40)));

    moduleInfo.tips.forEach(tip => {
      console.log(`  • ${chalk.dim(tip)}`);
    });
    console.log('');
  }

  // File information (if provided)
  if (moduleInfo.fileInfo) {
    console.log(chalk.bold.cyan('📁 FILES'));
    console.log(chalk.dim('━'.repeat(40)));

    if (moduleInfo.fileInfo.configFile) {
      console.log(`  Config: ${chalk.yellow(moduleInfo.fileInfo.configFile)}`);
    }
    if (moduleInfo.fileInfo.backupDir) {
      console.log(`  Backups: ${chalk.yellow(moduleInfo.fileInfo.backupDir)}`);
    }
    if (moduleInfo.fileInfo.logFile) {
      console.log(`  Logs: ${chalk.yellow(moduleInfo.fileInfo.logFile)}`);
    }
    console.log('');
  }

  console.log(
    chalk.dim('💡 For detailed help: ') +
      chalk.cyan(`pnpm ${moduleInfo.name.toLowerCase()} --help`)
  );
  console.log('');
}

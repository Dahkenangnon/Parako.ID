// CONSOLE LOGGING UTILITIES FOR PARAKO.ID MANAGEMENT SCRIPTS

import chalk from 'chalk';
import type { ConsoleLogger } from './types.js';

/**
 * Console styling utilities with enhanced formatting
 */
export const log: ConsoleLogger = {
  info: (msg: string) => console.log(chalk.cyan('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warning: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.log(chalk.red('✗'), msg),
  title: (msg: string) => {
    console.log(chalk.bold.cyan(`\n🔧 ${msg}`));
    console.log(chalk.cyan('━'.repeat(60)));
  },
  subtitle: (msg: string) => console.log(chalk.dim(msg)),
  highlight: (msg: string) => console.log(chalk.yellow(msg)),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  progress: (msg: string) => console.log(chalk.blue('⏳'), msg),
  debug: (msg: string) => {
    if (process.env.DEBUG) {
      console.log(chalk.gray('🐛'), chalk.gray(msg));
    }
  },
};

export default log;

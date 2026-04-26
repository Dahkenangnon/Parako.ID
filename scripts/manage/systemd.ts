#!/usr/bin/env node

import { Command } from 'commander';
import { getPackageInfo } from './shared/utils.js';
import { setupCommands } from './systemd/commands.js';

const program = new Command();

program
  .name('systemd')
  .description('🐧 Parako.ID Systemd Service Manager')
  .version(getPackageInfo().version);

setupCommands(program);

program.parse();

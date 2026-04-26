#!/usr/bin/env node

// When the admin API is available, this script should become a thin
// zero-dep HTTP client using fetch() (Node 18+ built-in), eliminating
// the chalk/commander/inquirer production dependencies.

/**
 * Entry point for keys CLI module
 */

import './keys/commands.js';

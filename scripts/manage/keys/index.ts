#!/usr/bin/env node

/**
 * Key generation module for OIDC JWKS keys
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import * as jose from 'jose';

export interface JWK extends jose.JWK {
  use?: string;
  kid?: string;
}

export interface JWKS {
  keys: JWK[];
}

/**
 * Create a backup of the existing JWKS file
 */
export function createBackup(filePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;

  fs.copyFileSync(filePath, backupPath);
  console.log(chalk.green(`📦 Backup created: ${path.basename(backupPath)}`));

  return backupPath;
}

/**
 * Generate JWKS keys
 */
export async function generateKeys(
  includeEdDSA: boolean = true
): Promise<void> {
  const keys: JWK[] = [];

  console.log(chalk.cyan('\n🔑 Generating JWKS keys...\n'));

  console.log(chalk.dim('  Generating RS256 key...'));
  const rsaKey = await jose.generateKeyPair('RS256', { extractable: true });
  const rsaJwk = (await jose.exportJWK(rsaKey.privateKey)) as JWK;
  rsaJwk.use = 'sig';
  rsaJwk.kid = await jose.calculateJwkThumbprint(rsaJwk, 'sha256');
  keys.push(rsaJwk);
  console.log(chalk.green(`  ✓ RS256 generated`));

  console.log(chalk.dim('  Generating ES256 key...'));
  const ecKey = await jose.generateKeyPair('ES256', { extractable: true });
  const ecJwk = (await jose.exportJWK(ecKey.privateKey)) as JWK;
  ecJwk.use = 'sig';
  ecJwk.kid = await jose.calculateJwkThumbprint(ecJwk, 'sha256');
  keys.push(ecJwk);
  console.log(chalk.green(`  ✓ ES256 generated`));

  if (includeEdDSA) {
    console.log(chalk.dim('  Generating EdDSA key...'));
    const okpKey = await jose.generateKeyPair('EdDSA', { extractable: true });
    const okpJwk = (await jose.exportJWK(okpKey.privateKey)) as JWK;
    okpJwk.use = 'sig';
    okpJwk.kid = await jose.calculateJwkThumbprint(okpJwk, 'sha256');
    keys.push(okpJwk);
    console.log(chalk.green(`  ✓ EdDSA generated`));
  }

  const jwks: JWKS = { keys };

  const outputPath = path.resolve('./runtime/jwks/jwks.json');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(jwks, null, 2));
  console.log(chalk.green('\n✅ JWKS keys generated successfully'));
  console.log(chalk.dim(`Saved to: ${outputPath}\n`));
}

/**
 * Interactive generation with confirmation prompts
 */
export async function generateKeysInteractive(): Promise<void> {
  const outputPath = path.resolve('./runtime/jwks/jwks.json');
  const fileExists = fs.existsSync(outputPath);

  console.log(chalk.bold.cyan('\n🔐 OIDC JWKS Key Generation\n'));

  if (fileExists) {
    console.log(chalk.yellow('⚠️  Warning: A JWKS file already exists at:'));
    console.log(chalk.dim(`   ${outputPath}\n`));

    const { confirmOverwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmOverwrite',
        message: 'Do you want to overwrite the existing JWKS file?',
        default: false,
      },
    ]);

    if (!confirmOverwrite) {
      console.log(chalk.yellow('\n❌ Generation cancelled.\n'));
      return;
    }

    console.log();
    createBackup(outputPath);
  }

  await generateKeys(true);
}

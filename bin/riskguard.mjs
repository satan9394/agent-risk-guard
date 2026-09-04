#!/usr/bin/env node
// RiskGuard launcher — repo 内统一入口（v0.1.2）
// 用法：node bin/riskguard.mjs <command> [options]
// 相当于 node packages/cli/src/index.ts <command>，但用户不直接面对内部源码路径。
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // repo/bin
const root = join(here, '..');                        // repo root

await import(pathToFileURL(join(root, 'packages', 'cli', 'src', 'index.ts')).href);

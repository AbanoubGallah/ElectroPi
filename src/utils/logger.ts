/**
 * Test-scoped logger. Everything it prints is also attached to the Playwright
 * HTML report via `test.info().annotations`, so a CI failure carries its own
 * narrative instead of forcing a local re-run to find out what happened.
 */
import { test } from '@playwright/test';

const stamp = () => new Date().toISOString().slice(11, 23);

function emit(level: 'STEP' | 'INFO' | 'WARN', message: string): void {
  const line = `${stamp()} [${level}] ${message}`;
  if (process.env.PW_VERBOSE || level === 'WARN') console.log(line);
  try {
    test.info().annotations.push({ type: level.toLowerCase(), description: message });
  } catch {
    /* called outside a test context - console output is enough */
  }
}

export const logger = {
  step: (message: string) => emit('STEP', message),
  info: (message: string) => emit('INFO', message),
  warn: (message: string) => emit('WARN', message),
};

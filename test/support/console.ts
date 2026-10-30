/**
 * Console guard. Any console.error or console.warn a test does not claim with
 * expectLogged() fails that test.
 */

type Level = 'error' | 'warn';

interface Entry {
  level: Level;
  text: string;
}

const recorded: Entry[] = [];

function format(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

export function installConsoleGuard(): void {
  for (const level of ['error', 'warn'] as const) {
    console[level] = (...args: unknown[]) => {
      recorded.push({ level, text: format(args) });
    };
  }
}

/**
 * Claims every logged entry at `level` whose text contains `pattern`.
 * Throws if there is none.
 */
export function expectLogged(level: Level, pattern: string): void {
  const matches = (entry: Entry) =>
    entry.level === level && entry.text.includes(pattern);
  if (!recorded.some(matches)) {
    const seen = recorded.map((e) => `  console.${e.level}: ${e.text}`);
    throw new Error(
      `Expected console.${level} containing "${pattern}".\nRecorded:\n${seen.join('\n') || '  (nothing)'}`
    );
  }
  const rest = recorded.filter((entry) => !matches(entry));
  recorded.length = 0;
  recorded.push(...rest);
}

/**
 * Claims every entry logged so far. For tests that log on purpose and do not
 * care about the exact output.
 */
export function ignoreLogged(): void {
  recorded.length = 0;
}

export function assertNoUnexpectedLogs(): void {
  if (recorded.length === 0) return;
  const lines = recorded.map((e) => `  console.${e.level}: ${e.text}`);
  recorded.length = 0;
  throw new Error(
    `Unexpected console output. Claim it with expectLogged():\n${lines.join('\n')}`
  );
}

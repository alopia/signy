/**
 * Formats a message id with its readable text, for the logger and SignyError.
 *
 * @module log/format
 * @internal
 */

/**
 * A message id with its readable text, when signy-dev registered one:
 * `[app:not-mounted] Application is not mounted.`
 */
export function withDetails(message: string, details?: string): string {
  return details ? `[${message}] ${details}` : message;
}

/**
 * One versioned, transactionally-applied migration. SQL is embedded in the
 * bundle on purpose: the production server is a single esbuild output file,
 * so reading *.sql from disk at runtime would break once bundled.
 */
export interface Migration {
  /** Zero-padded monotonically increasing version, unique across migrations. */
  version: string;
  name: string;
  sql: string;
}

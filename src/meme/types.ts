/** Paths are relative to the site root, with no leading slash. */
export type Fetcher = (relPath: string) => Promise<Buffer>;

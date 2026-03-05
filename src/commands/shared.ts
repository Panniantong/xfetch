import chalk from 'chalk';
import { XClient } from '../lib/client/index.js';
import { SessionManager } from '../lib/auth/session.js';
import { createSessionFromTokens } from '../lib/auth/cookies.js';
import { Paginator, createPaginationOptions, type PaginationOptions } from '../lib/pagination.js';
import { outputJson } from '../lib/output/json.js';
import { outputJsonl } from '../lib/output/jsonl.js';
import { outputCsv } from '../lib/output/csv.js';
import { outputSqlite } from '../lib/output/sqlite.js';
import type { Session, PaginatedResult } from '../types/twitter.js';

export interface GlobalOptions {
  authToken?: string;
  ct0?: string;
  format?: string;
  db?: string;
  json?: boolean;
  plain?: boolean;
  proxy?: string;
  proxyFile?: string;
}

export interface PaginatedCommandOptions extends GlobalOptions {
  all?: boolean;
  maxPages?: string;
  resume?: string;
  delay?: string;
  count?: string;
  cursor?: string;
}

export async function getClient(options: GlobalOptions = {}): Promise<XClient> {
  let session: Session | null = null;

  // Priority 1: Direct tokens from CLI
  if (options.authToken && options.ct0) {
    session = createSessionFromTokens(options.authToken, options.ct0);
  }
  
  // Priority 2: Saved session
  if (!session) {
    const sessionManager = new SessionManager();
    session = sessionManager.load();
  }

  if (!session || !session.authToken || !session.ct0) {
    console.error(chalk.red('Not authenticated.'));
    console.error('');
    console.error('Use one of:');
    console.error('  xfetch auth set --auth-token <token> --ct0 <token>');
    console.error('  xfetch auth extract --browser chrome');
    console.error('  xfetch --auth-token <token> --ct0 <token> <command>');
    process.exit(1);
  }

  // Create client with proxy options if provided
  return new XClient(session, {
    proxy: options.proxy,
    proxyFile: options.proxyFile,
  });
}

/**
 * Execute a paginated fetch operation with full pagination support
 */
export async function executePaginated<T>(
  fetchFn: (cursor?: string) => Promise<PaginatedResult<T>>,
  options: PaginatedCommandOptions,
  outputOptions: GlobalOptions
): Promise<void> {
  const paginationOpts = createPaginationOptions({
    all: options.all,
    maxPages: options.maxPages,
    resume: options.resume,
    delay: options.delay,
  });

  // Single page fetch (no pagination flags)
  if (!options.all && !options.maxPages) {
    const result = await fetchFn(options.cursor);
    outputResult(result, outputOptions);
    return;
  }

  // Multi-page fetch with pagination
  const paginator = new Paginator<T>(paginationOpts);
  
  const { items, pagesLoaded, complete } = await paginator.fetchAll(
    (cursor) => fetchFn(cursor || options.cursor)
  );

  // Output all items
  outputResult({ 
    items, 
    pagesLoaded,
    complete,
    totalItems: items.length,
  }, outputOptions);
}

export function outputResult(data: unknown, options: GlobalOptions = {}): void {
  const format = options.json ? 'json' : (options.format || 'json');
  
  switch (format) {
    case 'json':
      outputJson(data, { pretty: !options.plain });
      break;
      
    case 'jsonl':
      outputJsonl(data);
      break;
      
    case 'csv':
      outputCsv(data);
      break;
      
    case 'sqlite':
      if (!options.db) {
        console.error(chalk.red('Error: --db <path> required for SQLite output'));
        process.exit(1);
      }
      const result = outputSqlite(data, { dbPath: options.db });
      console.error(chalk.green(`✓ Inserted ${result.inserted} records into ${result.tableName} table`));
      console.error(chalk.dim(`  Database: ${options.db}`));
      break;
      
    default:
      outputJson(data, { pretty: !options.plain });
  }
}

export function extractTweetId(urlOrId: string): string {
  // If it's already an ID
  if (/^\d+$/.test(urlOrId)) {
    return urlOrId;
  }
  
  // Extract from URL — supports both /status/ID and /article/ID
  const match = urlOrId.match(/(?:status|article)\/(\d+)/);
  if (match) {
    return match[1];
  }
  
  throw new Error(`Invalid tweet URL or ID: ${urlOrId}`);
}

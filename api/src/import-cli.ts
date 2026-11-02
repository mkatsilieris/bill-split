/**
 * Command-line import of a Splitwise CSV export (see README > Εισαγωγή από Splitwise).
 *
 *   node dist/import-cli.js <file.csv> [--group <id|όνομα>] [--users "A=email, B=email"] [--by <email>] [--dry-run]
 *
 * Prints the summary as JSON. Exit code 1 with the reason on stderr when nothing was imported.
 */
import { pool } from './db.js';
import { importSplitwise, type ImportOptions } from './import.js';

function parseArgs(argv: string[]): ImportOptions {
  const opts: ImportOptions = { file: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Λείπει τιμή για ${arg}`);
      return v;
    };
    if (arg === '--group') opts.group = value();
    else if (arg === '--users') opts.users = value();
    else if (arg === '--by') opts.by = value();
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`Άγνωστη επιλογή ${arg}`);
    else if (!opts.file) opts.file = arg;
    else throw new Error(`Απρόσμενο όρισμα ${arg}`);
  }
  if (!opts.file) {
    throw new Error(
      'Χρήση: import-cli.js <file.csv> [--group <id|όνομα>] [--users "A=email, B=email"] [--by <email>] [--dry-run]',
    );
  }
  return opts;
}

try {
  const summary = await importSplitwise(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(summary, null, 2));
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

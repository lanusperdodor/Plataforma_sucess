// Executa migrations e testes SQL em um PostgreSQL descartável LOCAL (nunca remoto).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? '.exe' : '';

function findBin() {
  const candidates = [
    process.env.PG_BIN,
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\15\\bin',
  ].filter(Boolean);
  for (const dir of candidates) {
    if (['initdb', 'pg_ctl', 'psql'].every((b) => existsSync(join(dir, b + exe)))) return dir;
  }
  throw new Error(
    'Binários do PostgreSQL (initdb/pg_ctl/psql) não encontrados. Defina PG_BIN com o diretório bin.',
  );
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

function sqlFiles(dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(full, f));
}

const one = (rel) => (existsSync(join(root, rel)) ? [join(root, rel)] : []);

async function main() {
  const bin = findBin();
  const tool = (n) => join(bin, n + exe);
  const dataDir = mkdtempSync(join(tmpdir(), 'pgsql-test-'));
  const port = String(await freePort());
  let started = false;
  let failed = false;

  try {
    let r = spawnSync(
      tool('initdb'),
      ['-D', join(dataDir, 'data'), '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`initdb falhou:\n${r.stdout}${r.stderr}`);

    r = spawnSync(
      tool('pg_ctl'),
      [
        'start', '-w', '-D', join(dataDir, 'data'), '-l', join(dataDir, 'pg.log'),
        '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off`,
      ],
      // stdio 'ignore': no Windows o postmaster herda os pipes e o spawnSync nunca retornaria.
      { stdio: 'ignore', timeout: 60_000 },
    );
    started = true;
    if (r.status !== 0) {
      const log = existsSync(join(dataDir, 'pg.log')) ? readFileSync(join(dataDir, 'pg.log'), 'utf8') : '';
      throw new Error(`pg_ctl start falhou (status ${r.status}):\n${log}`);
    }

    const files = [
      ...one('supabase/tests/local_auth_stub.sql'),
      ...one('supabase/tests/supabase_default_privileges.sql'),
      ...sqlFiles('supabase/migrations'),
      ...sqlFiles('supabase/seed'),
      ...one('supabase/tests/rls_foundation.sql'),
      ...one('supabase/tests/rls_experiencia.sql'),
      ...one('supabase/tests/rls_admin.sql'),
      ...sqlFiles('supabase/tests/props'),
    ];

    for (const file of files) {
      const label = file.slice(root.length + 1);
      const sql = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      console.log(`> ${label}`);
      const p = spawnSync(
        tool('psql'),
        ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-q',
          '-v', 'ON_ERROR_STOP=1', '-f', '-'],
        { input: sql, encoding: 'utf8', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } },
      );
      if (p.stdout) process.stdout.write(p.stdout);
      if (p.stderr) process.stderr.write(p.stderr);
      if (p.status !== 0) {
        failed = true;
        console.error(`FALHA em ${label}`);
        break;
      }
    }
  } catch (e) {
    failed = true;
    console.error(e instanceof Error ? e.message : e);
  } finally {
    if (started) {
      spawnSync(tool('pg_ctl'), ['stop', '-m', 'fast', '-w', '-D', join(dataDir, 'data')], {
        stdio: 'ignore',
        timeout: 60_000,
      });
    }
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      console.error(`Aviso: não foi possível remover ${dataDir}: ${e.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();

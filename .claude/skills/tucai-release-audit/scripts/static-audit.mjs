#!/usr/bin/env node
// Varredura estática da Tucaí para a auditoria de lançamento. SOMENTE LEITURA: não roda SQL, não acessa rede.
// Uso (na raiz do repositório): node .claude/skills/tucai-release-audit/scripts/static-audit.mjs [--out arquivo.json]
// Saída: lista de achados com gravidade sugerida (CRITICO, ALTO, MEDIO, BAIXO, INFO). Código 1 se houver CRITICO ou ALTO.
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const outArg = process.argv.indexOf("--out");
const outFile = outArg > 0 ? process.argv[outArg + 1] : null;
const findings = [];
const add = (severity, area, message, where = null) =>
  findings.push({ severity, area, message, where });
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (dir, filter, acc = []) => {
  const full = join(root, dir);
  if (!existsSync(full)) return acc;
  for (const f of readdirSync(full)) {
    const p = join(dir, f);
    if (statSync(join(root, p)).isDirectory()) {
      if (!/node_modules|\.git$/.test(f)) walk(p, filter, acc);
    } else if (filter(p)) acc.push(p);
  }
  return acc;
};
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

if (
  !existsSync(join(root, "supabase/migrations")) ||
  !existsSync(join(root, "package.json"))
) {
  console.error("Rode na raiz do repositório da Tucaí.");
  process.exit(2);
}

// ---------- migrations ----------
const migDir = "supabase/migrations";
const migs = readdirSync(join(root, migDir))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const nums = migs.map((f) => Number(f.slice(0, 4)));
nums.forEach((n, i) => {
  if (i > 0 && n !== nums[i - 1] + 1)
    add(
      "ALTO",
      "migrations",
      `Numeração com salto ou repetição entre ${migs[i - 1]} e ${migs[i]}`,
    );
});
add("INFO", "migrations", `${migs.length} migrations; última: ${migs.at(-1)}`);

const bundlePath = "supabase/admin/apply_all_migrations.sql";
if (!existsSync(join(root, bundlePath)))
  add(
    "ALTO",
    "migrations",
    "Pacote apply_all_migrations.sql ausente (rode npm run sql:bundle)",
  );
else {
  const bundle = read(bundlePath);
  for (const m of migs)
    if (
      !bundle.includes(m.replace(/\.sql$/, "")) &&
      !bundle.includes(`Tucaí ${m.slice(0, 4)}`)
    )
      add(
        "ALTO",
        "migrations",
        `Migration fora do pacote: ${m} (rode npm run sql:bundle)`,
        bundlePath,
      );
}

let anonBusinesses = null; // estado FINAL do SELECT de anon em public.businesses (grant/revoke na ordem das migrations)
const allSql = migs.map((f) => ({ f, text: read(join(migDir, f)) }));
const created = new Map(); // tabela -> arquivo
const rls = new Set();
const dropped = new Set();
for (const { f, text } of allSql) {
  for (const m of text.matchAll(
    /create table (?:if not exists )?public\.([a-z_0-9]+)/gi,
  ))
    if (!created.has(m[1])) created.set(m[1], f);
  for (const m of text.matchAll(
    /alter table (?:if exists )?(?:only )?public\.([a-z_0-9]+)\s+enable row level security/gi,
  ))
    rls.add(m[1]);
  for (const m of text.matchAll(
    /drop table (?:if exists )?public\.([a-z_0-9]+)/gi,
  ))
    dropped.add(m[1]);
  // RLS ligada em laço: execute format('alter table public.%I enable row level security', t) sobre array['a', 'b', ...]
  for (const blk of text.matchAll(/do \$\$[\s\S]*?end \$\$/gi)) {
    if (!/enable row level security/i.test(blk[0]) || !/%I/.test(blk[0]))
      continue;
    for (const arr of blk[0].matchAll(/array\s*\[([^\]]*)\]/gi))
      for (const q of arr[1].matchAll(/'([a-z_0-9]+)'/g)) rls.add(q[1]);
  }

  // funções SECURITY DEFINER: cabeçalho até o corpo
  for (const m of text.matchAll(
    /create (?:or replace )?function\s+([a-z_0-9.]+)\s*\(([\s\S]*?)\$(\w*)\$/gi,
  )) {
    const header = m[0];
    if (!/security definer/i.test(header)) continue;
    if (!/set search_path\s*(=|to)\s*(''|""|pg_catalog|public)/i.test(header))
      add(
        "CRITICO",
        "sql-seguranca",
        `SECURITY DEFINER sem search_path fixo: ${m[1]}`,
        `${migDir}/${f}:${lineOf(text, m.index)}`,
      );
    else if (!/set search_path\s*(=|to)\s*''/i.test(header))
      add(
        "MEDIO",
        "sql-seguranca",
        `SECURITY DEFINER com search_path diferente de '': ${m[1]}`,
        `${migDir}/${f}:${lineOf(text, m.index)}`,
      );
  }
  for (const m of text.matchAll(
    /grant\s+([a-z, ]+?)\s+on\s+(?:table\s+)?public\.([a-z_0-9]+)\s+to\s+([a-z_, ]*\banon\b[a-z_, ]*)/gi,
  )) {
    if (/insert|update|delete|all/i.test(m[1]))
      add(
        "CRITICO",
        "rls",
        `Escrita concedida a anon: ${m[1]} em public.${m[2]}`,
        `${migDir}/${f}:${lineOf(text, m.index)}`,
      );
  }
  for (const m of text.matchAll(
    /(grant\s+select\s+on\s+public\.businesses\s+to\s+[^;]*\banon\b)|(revoke\s+(?:select|all)[^;]*\bon\s+(?:public\.[a-z_, ]*\s*)?public\.businesses\b[^;]*\bfrom\s+[^;]*\banon\b)|(revoke\s+(?:select|all)\s+on\s+public\.businesses\s+from\s+[^;]*\banon\b)/gi,
  )) {
    anonBusinesses = m[1] ? `${migDir}/${f}:${lineOf(text, m.index)}` : null;
  }
  for (const m of text.matchAll(
    /create (?:or replace )?view\s+public\.([a-z_0-9]+)(?![^;]*security_invoker)/gi,
  )) {
    // só a última definição de cada visão importa: verificada abaixo
    void m;
  }
  if (/disable row level security/i.test(text))
    add("CRITICO", "rls", "Migration desativa RLS", `${migDir}/${f}`);
}
if (anonBusinesses)
  add(
    "CRITICO",
    "rls",
    "SELECT em public.businesses continua concedido a anon",
    anonBusinesses,
  );
for (const [t, f] of created)
  if (!dropped.has(t) && !rls.has(t))
    add(
      "CRITICO",
      "rls",
      `Tabela public.${t} sem enable row level security`,
      `${migDir}/${f}`,
    );
add(
  "INFO",
  "rls",
  `${created.size} tabelas em public; ${[...created.keys()].filter((t) => rls.has(t)).length} com RLS`,
);

// última definição de cada visão pública precisa ser security_invoker
const views = new Map();
for (const { f, text } of allSql)
  for (const m of text.matchAll(
    /create (?:or replace )?view\s+public\.([a-z_0-9]+)([^;]*?)\bas\b/gi,
  ))
    views.set(m[1], { f, opts: m[2], line: lineOf(text, m.index) });
for (const [v, d] of views)
  if (!/security_invoker\s*=\s*(true|on)/i.test(d.opts))
    add(
      "ALTO",
      "rls",
      `Visão public.${v} sem security_invoker (alerta "Security Definer View")`,
      `${migDir}/${d.f}:${d.line}`,
    );

// ---------- frontend ----------
const src = walk(
  "src",
  (p) =>
    /\.(ts|tsx)$/.test(p) &&
    !/\.test\.tsx?$/.test(p) &&
    !p.startsWith("src/worker"),
);
/** Remove comentários mantendo as quebras de linha (os números de linha continuam certos). */
const code = (t) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:'"`])\/\/[^\n]*/g,
      (c, pre) => pre + " ".repeat(c.length - pre.length),
    );
for (const p of src) {
  const t = code(read(p));
  const hit = (re, sev, msg) => {
    const m = t.match(re);
    if (m) add(sev, "frontend", msg, `${p}:${lineOf(t, m.index)}`);
  };
  hit(
    /\bservice_role\b|\bSERVICE_ROLE(_KEY)?\b/,
    "CRITICO",
    "Referência a service_role no frontend",
  );
  hit(/sb_secret_/, "CRITICO", "Chave secreta do Supabase no frontend");
  hit(/\bauth\.admin\./, "CRITICO", "Admin API do Supabase usada no frontend");
  hit(
    /dangerouslySetInnerHTML/,
    "MEDIO",
    "HTML inserido sem sanitização (confira a origem do conteúdo)",
  );
  hit(/\beval\(|new Function\(/, "ALTO", "eval/new Function no frontend");
  hit(
    /localStorage\.setItem\([^)]*(senha|password|token)/i,
    "ALTO",
    "Senha ou token gravado no localStorage",
  );
  hit(
    /console\.log\([^)]*(senha|password)/i,
    "ALTO",
    "Senha enviada ao console",
  );
}
// gravações diretas do frontend em tabelas sensíveis (devem passar por funções no banco)
for (const p of src) {
  const t = code(read(p));
  for (const m of t.matchAll(
    /from\('(orders|deliveries|user_roles|platform_charges|courier_withdrawals|business_members|pricing_configs)'\)\s*\.(insert|update|upsert|delete)/g,
  )) {
    add(
      "ALTO",
      "permissoes",
      `Escrita direta em ${m[1]} pelo frontend (${m[2]}); confirme a política RLS que a limita`,
      `${p}:${lineOf(t, m.index)}`,
    );
  }
}

// OAuth
if (existsSync(join(root, "src/features/auth/signIn.ts"))) {
  const t = read("src/features/auth/signIn.ts");
  if (!/signInWithOAuth/.test(t))
    add("MEDIO", "oauth", "signInWithOAuth não encontrado em signIn.ts");
  if (/redirectTo:\s*['"`]https?:\/\/localhost/.test(t))
    add(
      "ALTO",
      "oauth",
      "redirectTo fixo em localhost",
      "src/features/auth/signIn.ts",
    );
  if (!/redirectTo/.test(t))
    add(
      "MEDIO",
      "oauth",
      "OAuth sem redirectTo explícito (depende do Site URL do Supabase)",
      "src/features/auth/signIn.ts",
    );
}
const pub = existsSync(join(root, "src/config/supabase-public.ts"))
  ? code(read("src/config/supabase-public.ts"))
  : "";
if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl/.test(pub))
  add("CRITICO", "frontend", "Chave service_role em supabase-public.ts");

// ---------- Worker ----------
const wr = existsSync(join(root, "wrangler.jsonc"))
  ? read("wrangler.jsonc")
  : "";
if (!wr) add("ALTO", "worker", "wrangler.jsonc ausente");
else {
  if (!/"compatibility_date"\s*:\s*"\d{4}-\d{2}-\d{2}"/.test(wr))
    add("ALTO", "worker", "compatibility_date ausente");
  if (!/"binding"\s*:\s*"ASSETS"/.test(wr))
    add("ALTO", "worker", "Binding ASSETS ausente");
  if (!/"main"\s*:\s*"src\/worker\/index\.ts"/.test(wr))
    add("MEDIO", "worker", "main do Worker diferente de src/worker/index.ts");
  const site = wr.match(/"SITE_URL"\s*:\s*"([^"]*)"/)?.[1];
  add("INFO", "worker", `SITE_URL = ${site ?? "(ausente)"}`);
  if (site && /\/$/.test(site))
    add("MEDIO", "worker", "SITE_URL com barra final");
  if (/(SECRET|TOKEN|PASSWORD|SERVICE_ROLE)[A-Z_]*"\s*:\s*"[^"]{8,}"/.test(wr))
    add(
      "CRITICO",
      "worker",
      "Possível segredo em vars do wrangler.jsonc (use wrangler secret)",
    );
}
for (const p of walk(
  "src/worker",
  (x) => /\.ts$/.test(x) && !/\.test\.ts$/.test(x),
)) {
  const t = read(p);
  const m = t.match(
    /from ['"](fs|path|child_process|net|http|os)['"]|require\(['"](fs|path|child_process)['"]\)/,
  );
  if (m)
    add(
      "ALTO",
      "worker",
      `Módulo exclusivo do Node no Worker: ${m[0]}`,
      `${p}:${lineOf(t, m.index)}`,
    );
}
if (
  existsSync(join(root, "src/worker/index.ts")) &&
  !/if-none-match|If-None-Match/i.test(read("src/worker/index.ts"))
) {
  add(
    "MEDIO",
    "worker",
    "Worker não trata cabeçalhos condicionais (risco de tela branca ao recarregar)",
    "src/worker/index.ts",
  );
}

// ---------- SEO ----------
const html = existsSync(join(root, "index.html")) ? read("index.html") : "";
if (!/<title>[^<]{10,}<\/title>/.test(html))
  add("MEDIO", "seo", "index.html sem <title> adequado");
if (!/<meta name="description" content="[^"]{50,}"/.test(html))
  add("MEDIO", "seo", "index.html sem meta description (50+ caracteres)");
if (!/<html[^>]*lang="pt-BR"/i.test(html))
  add("BAIXO", "seo", 'index.html sem lang="pt-BR"');
const worker = existsSync(join(root, "src/worker/index.ts"))
  ? read("src/worker/index.ts") +
    (existsSync(join(root, "src/worker/seo.ts"))
      ? read("src/worker/seo.ts")
      : "")
  : "";
const workerAll =
  walk("src/worker", (x) => /\.ts$/.test(x) && !/\.test\.ts$/.test(x))
    .map(read)
    .join("\n") + worker;
if (!/robots\.txt/.test(workerAll))
  add("MEDIO", "seo", "Worker não gera /robots.txt");
if (!/sitemap\.xml/.test(workerAll))
  add("MEDIO", "seo", "Worker não gera /sitemap.xml");
if (!/noindex/.test(workerAll))
  add("MEDIO", "seo", "Sem noindex fora do domínio canônico");

// ---------- testes e CI ----------
const testSql = existsSync(join(root, "scripts/test-sql.mjs"))
  ? read("scripts/test-sql.mjs")
  : "";
for (const f of readdirSync(join(root, "supabase/tests")).filter((x) =>
  /^rls_.*\.sql$/.test(x),
)) {
  if (!testSql.includes(f))
    add(
      "ALTO",
      "testes",
      `Teste SQL não registrado em scripts/test-sql.mjs: ${f}`,
    );
}
const ci = existsSync(join(root, ".github/workflows/ci.yml"))
  ? read(".github/workflows/ci.yml")
  : "";
for (const step of [
  "typecheck",
  "lint",
  "vitest",
  "build",
  "check-secrets",
  "test-sql",
])
  if (!ci.includes(step)) add("MEDIO", "testes", `CI sem o passo ${step}`);
const gi = existsSync(join(root, ".gitignore")) ? read(".gitignore") : "";
if (!/^\.env/m.test(gi)) add("ALTO", "segredos", ".env* fora do .gitignore");

// ---------- saída ----------
const order = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAIXO: 3, INFO: 4 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const count = Object.fromEntries(
  Object.keys(order).map((k) => [
    k,
    findings.filter((f) => f.severity === k).length,
  ]),
);
for (const f of findings)
  console.log(
    `[${f.severity}] ${f.area}: ${f.message}${f.where ? ` (${relative(root, join(root, f.where))})` : ""}`,
  );
console.log(
  `\nResumo: ${Object.entries(count)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ")}`,
);
if (outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), count, findings },
      null,
      2,
    ),
  );
}
process.exit(count.CRITICO + count.ALTO > 0 ? 1 : 0);

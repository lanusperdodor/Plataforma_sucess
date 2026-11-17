// Monta a versão claude.ai (Artifact) a partir do build web (`npx expo export --platform web`).
// - Caminhos absolutos ("/assets/...") viram relativos, resolvidos por uma tag <base> criada no início.
// - A página de entrada segue o formato de página do claude.ai (sem <html>/<head>; o serviço adiciona).
// Saída: artifact-build/ (index.html = página; o resto vai como arquivos de apoio).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const out = join(root, 'artifact-build');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Rode antes: npx expo export --platform web');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const jsDir = join(dist, '_expo/static/js/web');
const bundles = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
if (bundles.length !== 1) throw new Error(`Esperava um único pacote JS (asyncRoutes: false); achei ${bundles.length}`);
const bundle = bundles[0];
let js = readFileSync(join(jsDir, bundle), 'utf8');
const before = (js.match(/"\/assets\//g) ?? []).length;
js = js.replaceAll('"/assets/', '"assets/');
if (/"\/_expo\//.test(js)) throw new Error('O pacote ainda referencia /_expo/ por caminho absoluto');
mkdirSync(join(out, 'app'), { recursive: true });
writeFileSync(join(out, 'app', bundle), js);
cpSync(join(dist, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(join(dist, 'sqljs'), join(out, 'sqljs'), { recursive: true });

const page = `<title>Fluentia</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
  :root { --bg: #0C0C11; color-scheme: dark; }
  html, body { height: 100%; background: var(--bg); }
  body { overflow: hidden; }
  #root { display: flex; height: 100%; flex: 1; }
  #boot { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; color: #9C9CAB; font: 15px system-ui, sans-serif; }
</style>
<div id="boot">Carregando o Fluentia…</div>
<div id="root"></div>
<script>
  // Arquivos de apoio ficam ao lado da página: uma <base> fixa os caminhos relativos mesmo depois que o
  // roteador do app troca a rota interna (history), e a rota interna começa em "/".
  (function () {
    var here = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    var base = document.createElement('base');
    base.href = here;
    document.head.appendChild(base);
    try { history.replaceState(null, '', '/' + location.hash); } catch (e) {}
  })();
</script>
<script src="app/${bundle}" defer></script>
<script>window.addEventListener('load', function () { setTimeout(function () { var b = document.getElementById('boot'); if (b) b.remove(); }, 1500); });</script>
`;
writeFileSync(join(out, 'index.html'), page);

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p !== join(out, 'index.html')) files.push(relative(out, p));
  }
};
walk(out);
writeFileSync(join(out, '..', 'artifact-files.json'), JSON.stringify(Object.fromEntries(files.map((f) => [f, `artifact-build/${f}`])), null, 1));
console.log(`ok: ${files.length} arquivos de apoio, ${before} caminhos de assets ajustados, pacote ${bundle}`);

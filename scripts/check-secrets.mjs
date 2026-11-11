// Procura segredos nos arquivos versionados (git ls-files) e no build (dist/, se existir).
// Falha com código 1 ao encontrar algo. Não imprime o valor encontrado, só o arquivo e a regra.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RULES = [
  ['Chave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT com papel service_role', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\./],
  ['Chave secreta Supabase (sb_secret_)', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ['Token GitHub', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['Chave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['Chave Stripe secreta', /\bsk_live_[A-Za-z0-9]{20,}/],
  ['Token de acesso Mercado Pago', /\bAPP_USR-\d{6,}-\d{6}-[a-f0-9]{32}-\d+/],
  ['Chave de API Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Variável service_role preenchida', /SERVICE_ROLE(_KEY)?\s*=\s*['"]?[A-Za-z0-9._-]{20,}/],
]
const SKIP = /(^|\/)(package-lock\.json|node_modules\/|\.git\/)|\.(png|jpg|jpeg|mp4|webp|ico|woff2?)$/

function files() {
  const tracked = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean)
  const built = []
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else built.push(p)
    }
  }
  if (existsSync('dist')) walk('dist')
  return [...tracked, ...built].filter((f) => !SKIP.test(f) && existsSync(f) && f !== 'scripts/check-secrets.mjs')
}

let found = 0
for (const f of files()) {
  const text = readFileSync(f, 'utf8')
  for (const [name, re] of RULES) {
    if (re.test(text)) {
      found++
      console.error(`POSSÍVEL SEGREDO: ${f} (${name})`)
    }
  }
}
if (found) {
  console.error(`\n${found} ocorrência(s). Remova o segredo, revogue-o no provedor e reescreva o histórico se já foi publicado.`)
  process.exit(1)
}
console.log('Nenhum segredo encontrado nos arquivos versionados nem no build.')

// Synchronise la roadmap (.github/roadmap/roadmap.json) avec GitHub : labels, milestones et issues.
// Idempotent : ne crée que ce qui manque (labels par nom, milestones par titre, issues par titre
// exact) et ne modifie, ne ferme ni ne supprime jamais une issue existante.
//
// Usage :
//   node scripts/roadmap-sync.mjs --dry-run          vérifie le fichier et affiche le plan (hors ligne)
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/roadmap-sync.mjs
import { readFileSync } from 'node:fs'

const ROADMAP = new URL('../.github/roadmap/roadmap.json', import.meta.url)
// GITHUB_API_URL est fourni par GitHub Actions (permet aussi un serveur de test local)
const API = process.env['GITHUB_API_URL'] ?? 'https://api.github.com'
/** Pause entre deux créations d'issues (ordre conservé, limites secondaires de GitHub respectées). */
const ISSUE_DELAY_MS = Number(process.env['ROADMAP_ISSUE_DELAY_MS'] ?? 1500)

/** Vérifie la structure du fichier ; lève une erreur explicite au premier problème. */
function validate(roadmap) {
  const fail = (message) => {
    throw new Error(`roadmap.json invalide : ${message}`)
  }
  const isText = (v) => typeof v === 'string' && v.trim().length > 0
  if (!Array.isArray(roadmap.labels) || !Array.isArray(roadmap.milestones) || !Array.isArray(roadmap.issues))
    fail('les clés labels, milestones et issues doivent être des tableaux')
  const labels = new Set()
  for (const l of roadmap.labels) {
    if (!isText(l.name) || !/^[0-9a-f]{6}$/i.test(l.color ?? '') || typeof l.description !== 'string')
      fail(`label incorrect (${JSON.stringify(l)})`)
    if (labels.has(l.name)) fail(`label en double : ${l.name}`)
    labels.add(l.name)
  }
  const milestones = new Set()
  for (const m of roadmap.milestones) {
    if (!isText(m.title) || typeof m.description !== 'string')
      fail(`milestone incorrect (${JSON.stringify(m)})`)
    if (milestones.has(m.title)) fail(`milestone en double : ${m.title}`)
    milestones.add(m.title)
  }
  const titles = new Set()
  for (const i of roadmap.issues) {
    if (!isText(i.title) || !isText(i.body)) fail(`issue sans titre ou sans description (${i.title ?? '?'})`)
    if (titles.has(i.title)) fail(`issue en double : ${i.title}`)
    titles.add(i.title)
    if (!milestones.has(i.milestone)) fail(`milestone inconnu « ${i.milestone} » pour « ${i.title} »`)
    if (!Array.isArray(i.labels) || i.labels.some((l) => !labels.has(l)))
      fail(`label inconnu pour « ${i.title} » (${JSON.stringify(i.labels)})`)
    if (!/- \[ \] /.test(i.body)) fail(`« ${i.title} » n'a aucun critère d'acceptation à cocher`)
  }
}

/** Client minimal de l'API REST GitHub (jeton du workflow). */
function github(repository, token) {
  const request = async (method, path, body) => {
    const res = await fetch(`${API}/repos/${repository}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`)
    return res.json()
  }
  /** Lit toutes les pages d'une liste. */
  const list = async (path) => {
    const items = []
    for (let page = 1; ; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const chunk = await request('GET', `${path}${sep}per_page=100&page=${page}`)
      items.push(...chunk)
      if (chunk.length < 100) return items
    }
  }
  return { request, list }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const roadmap = JSON.parse(readFileSync(ROADMAP, 'utf8'))
  validate(roadmap)
  console.log(
    `Roadmap valide : ${roadmap.labels.length} labels, ${roadmap.milestones.length} milestones, ${roadmap.issues.length} issues.`
  )
  if (dryRun) {
    for (const m of roadmap.milestones) {
      const issues = roadmap.issues.filter((i) => i.milestone === m.title)
      console.log(`\n${m.title} (${issues.length})`)
      for (const i of issues) console.log(`  - ${i.title}  [${i.labels.join(', ')}]`)
    }
    return
  }

  const repository = process.env['GITHUB_REPOSITORY']
  const token = process.env['GITHUB_TOKEN']
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY et GITHUB_TOKEN sont requis (ou --dry-run).')
  const gh = github(repository, token)

  const existingLabels = new Set((await gh.list('/labels')).map((l) => l.name))
  for (const l of roadmap.labels) {
    if (existingLabels.has(l.name)) continue
    await gh.request('POST', '/labels', l)
    console.log(`Label créé : ${l.name}`)
  }

  const milestoneNumbers = new Map((await gh.list('/milestones?state=all')).map((m) => [m.title, m.number]))
  for (const m of roadmap.milestones) {
    if (milestoneNumbers.has(m.title)) continue
    const created = await gh.request('POST', '/milestones', m)
    milestoneNumbers.set(m.title, created.number)
    console.log(`Milestone créé : ${m.title} (#${created.number})`)
  }

  // Les pull requests apparaissent aussi dans /issues : elles sont ignorées
  const existingIssues = new Set(
    (await gh.list('/issues?state=all')).filter((i) => !i.pull_request).map((i) => i.title)
  )
  let created = 0
  for (const i of roadmap.issues) {
    if (existingIssues.has(i.title)) continue
    const issue = await gh.request('POST', '/issues', {
      title: i.title,
      body: i.body,
      labels: i.labels,
      milestone: milestoneNumbers.get(i.milestone)
    })
    created++
    console.log(`Issue créée : #${issue.number} ${i.title}`)
    await sleep(ISSUE_DELAY_MS)
  }
  console.log(
    `\nTerminé : ${created} issue(s) créée(s), ${roadmap.issues.length - created} déjà présente(s).`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

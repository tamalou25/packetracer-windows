/**
 * Mises à jour automatiques (electron-updater) depuis les releases GitHub du projet.
 * - Seule l'application installée est concernée (installeur Windows ou AppImage), jamais le développement.
 * - Au démarrage : vérification discrète, téléchargement en arrière-plan (progression dans la barre
 *   des tâches) puis proposition de redémarrer ; à défaut, la mise à jour s'installe à la fermeture.
 * - Aide > Rechercher des mises à jour… : vérification manuelle, chaque issue est annoncée.
 * Seuls les fichiers publics de la release sont lus (latest.yml) : aucun jeton n'est embarqué.
 */
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'

/** Délai avant la vérification du démarrage (la fenêtre s'affiche d'abord). */
const STARTUP_CHECK_DELAY_MS = 5_000

export interface UpdaterHost {
  /** Fenêtre principale (parent des dialogues), si elle est ouverte. */
  window(): BrowserWindow | null
  /** Ferme l'application (question « Enregistrer ? » comprise) puis appelle installUpdateNow(). */
  restartToInstall(): void
}

type Phase = 'idle' | 'checking' | 'downloading' | 'downloaded'

let host: UpdaterHost | null = null
let phase: Phase = 'idle'
let available: UpdateInfo | null = null
let percent = 0
/** Vérification lancée depuis le menu : son issue est annoncée par un dialogue. */
let manual = false
/** L'utilisateur sait qu'un téléchargement est en cours : un échec lui est signalé. */
let announced = false

/** Vrai si cette copie peut se mettre à jour (application installée, pas le développement). */
export function updatesSupported(): boolean {
  return app.isPackaged && autoUpdater.isUpdaterActive()
}

function show(options: MessageBoxOptions): Promise<number> {
  const opts: MessageBoxOptions = { title: 'ServerLab', noLink: true, ...options }
  const win = host?.window()
  const box = win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
  return box.then((r) => r.response)
}

/** Progression du téléchargement dans la barre des tâches (-1 la retire). */
function setProgress(value: number): void {
  const win = host?.window()
  if (win && !win.isDestroyed()) win.setProgressBar(value)
}

/** Message compréhensible pour une erreur de vérification ou de téléchargement. */
function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const text = `${typeof code === 'string' ? code : ''} ${error instanceof Error ? error.message : String(error)}`
  const network = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|TIMED_OUT|ENOTFOUND|ECONN/i
  if (network.test(text))
    return 'Le serveur de mises à jour est injoignable. Vérifiez la connexion Internet puis réessayez.'
  // Réseau d'établissement : un proxy filtrant présente souvent son propre certificat
  if (/ERR_CERT_/i.test(text))
    return 'La connexion sécurisée à GitHub a été refusée (certificat non reconnu : proxy ou pare-feu filtrant ?).'
  if (/\b404\b|LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND|NO_PUBLISHED_VERSIONS/i.test(text))
    return 'Aucune version publiée n’est accessible sur GitHub (release absente ou dépôt privé).'
  return 'La vérification des mises à jour a échoué. Réessayez plus tard.'
}

/** Mise à jour téléchargée : redémarrer maintenant ou l'installer à la prochaine fermeture. */
async function promptInstall(info: UpdateInfo): Promise<void> {
  const choice = await show({
    type: 'info',
    message: `ServerLab ${info.version} est prêt à être installé.`,
    detail:
      'Redémarrez pour utiliser la nouvelle version (vos modifications non enregistrées vous seront ' +
      'proposées à l’enregistrement). Sinon, elle s’installera à la fermeture de l’application.',
    buttons: ['Redémarrer maintenant', 'Plus tard'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice === 0) host?.restartToInstall()
}

/** Délai au-delà duquel l'application se ferme même si l'installeur n'a pas pu démarrer. */
const QUIT_FALLBACK_MS = 3_000

/** Installe la mise à jour téléchargée sans assistant, puis relance l'application. */
export function installUpdateNow(): void {
  autoUpdater.quitAndInstall(true, true)
  // En cas d'échec, quitAndInstall ne ferme pas l'application : aucune fenêtre ne doit rester orpheline
  setTimeout(() => app.quit(), QUIT_FALLBACK_MS)
}

async function check(): Promise<void> {
  try {
    const result = await autoUpdater.checkForUpdates()
    // Les échecs du téléchargement sont signalés par l'événement « error »
    result?.downloadPromise?.catch(() => undefined)
  } catch {
    // Signalé par l'événement « error »
  }
}

function listen(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    phase = 'checking'
  })
  autoUpdater.on('update-not-available', () => {
    phase = 'idle'
    if (!manual) return
    manual = false
    void show({
      type: 'info',
      message: 'ServerLab est à jour.',
      detail: `Version installée : ${app.getVersion()}.`
    })
  })
  autoUpdater.on('update-available', (info) => {
    phase = 'downloading'
    available = info
    percent = 0
    if (!manual) return
    manual = false
    announced = true
    void show({
      type: 'info',
      message: `La version ${info.version} est disponible.`,
      detail: 'Elle se télécharge en arrière-plan ; vous serez prévenu dès qu’elle pourra être installée.'
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    percent = Math.round(progress.percent)
    setProgress(progress.percent / 100)
  })
  autoUpdater.on('update-downloaded', (info) => {
    phase = 'downloaded'
    available = info
    announced = false
    setProgress(-1)
    void promptInstall(info)
  })
  autoUpdater.on('error', (error) => {
    const downloading = phase === 'downloading'
    phase = 'idle'
    setProgress(-1)
    if (!manual && !(downloading && announced)) return
    manual = false
    announced = false
    void show({
      type: 'error',
      message: downloading
        ? 'Le téléchargement de la mise à jour a échoué.'
        : 'Impossible de rechercher les mises à jour.',
      detail: describeError(error)
    })
  })
}

/** Branche les mises à jour et programme la vérification du démarrage (application installée). */
export function initUpdater(updaterHost: UpdaterHost): void {
  host = updaterHost
  if (!updatesSupported()) return
  listen()
  setTimeout(() => void check(), STARTUP_CHECK_DELAY_MS)
}

/** Aide > Rechercher des mises à jour… */
export function checkForUpdatesFromMenu(): void {
  if (!updatesSupported()) {
    void show({
      type: 'info',
      message: 'Mises à jour automatiques indisponibles pour cette copie.',
      detail:
        'Seule la version installée (installeur Windows ou AppImage Linux) se met à jour depuis les ' +
        'releases GitHub. Une copie de développement se met à jour avec le dépôt (git pull).'
    })
    return
  }
  switch (phase) {
    case 'downloaded':
      if (available) void promptInstall(available)
      return
    case 'downloading':
      announced = true
      void show({
        type: 'info',
        message: `Téléchargement de la version ${available?.version ?? ''} en cours (${percent} %).`,
        detail: 'Vous serez prévenu dès qu’elle pourra être installée.'
      })
      return
    case 'checking':
      manual = true
      return
    case 'idle':
      manual = true
      void check()
  }
}

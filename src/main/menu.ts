/**
 * Barre de menu native en français.
 * Les actions métier sont déléguées au renderer via le canal IPC `menu:command`.
 */
import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand, type MenuState, type RecentFile, type ThemePreference } from '../shared/ipc'
import { accelerator } from '../shared/shortcuts'

export interface MenuContext {
  window: BrowserWindow
  state: MenuState
  recent: RecentFile[]
  /** Préférence de thème (bouton radio coché dans Affichage > Thème). */
  theme: ThemePreference
  onTheme: (preference: ThemePreference) => void
  onCheckUpdates?: () => void
}

/** Envoie une commande de menu au renderer. */
function send(win: BrowserWindow, command: MenuCommand, arg?: string): void {
  if (!win.isDestroyed())
    win.webContents.send(IPC.menuCommand, arg === undefined ? { command } : { command, arg })
}

/**
 * Raccourci affiché mais non intercepté par le menu : le renderer le gère lui-même
 * (ex. Suppr ou Ctrl+Z ne doivent pas être volés aux champs de saisie).
 */
function displayOnly(
  accelerator: string
): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> {
  return { accelerator, registerAccelerator: false }
}

export function buildMenu(ctx: MenuContext): Menu {
  const { window: win, state, recent } = ctx
  const cmd = (command: MenuCommand, arg?: string) => () => send(win, command, arg)

  const recentItems: MenuItemConstructorOptions[] =
    recent.length === 0
      ? [{ label: 'Aucun fichier récent', enabled: false }]
      : recent.map((r, i) => ({
          label: `${i + 1}. ${r.name}`,
          toolTip: r.path,
          click: cmd('file:openRecent', r.path)
        }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&Fichier',
      submenu: [
        { label: 'Nouveau', accelerator: accelerator('newFile'), click: cmd('file:new') },
        { label: 'Ouvrir…', accelerator: accelerator('open'), click: cmd('file:open') },
        { label: 'Fichiers récents', submenu: recentItems },
        { type: 'separator' },
        { label: 'Enregistrer', accelerator: accelerator('save'), click: cmd('file:save') },
        { label: 'Enregistrer sous…', accelerator: accelerator('saveAs'), click: cmd('file:saveAs') },
        { type: 'separator' },
        { label: 'Ouvrir un lab…', accelerator: accelerator('openLab'), click: cmd('file:openLab') },
        { type: 'separator' },
        { label: 'Quitter', accelerator: accelerator('quit'), click: () => win.close() }
      ]
    },
    {
      label: '&Édition',
      submenu: [
        {
          label: state.undoLabel ?? 'Annuler',
          enabled: state.undoLabel !== null,
          ...displayOnly(accelerator('undo')),
          click: cmd('edit:undo')
        },
        {
          label: state.redoLabel ?? 'Rétablir',
          enabled: state.redoLabel !== null,
          ...displayOnly(accelerator('redo')),
          click: cmd('edit:redo')
        },
        { type: 'separator' },
        { label: 'Copier', ...displayOnly(accelerator('copy')), click: cmd('edit:copy') },
        { label: 'Coller', ...displayOnly(accelerator('paste')), click: cmd('edit:paste') },
        { label: 'Supprimer', ...displayOnly(accelerator('delete')), click: cmd('edit:delete') },
        { type: 'separator' },
        { label: 'Tout sélectionner', ...displayOnly(accelerator('selectAll')), click: cmd('edit:selectAll') }
      ]
    },
    {
      label: '&Affichage',
      submenu: [
        { label: 'Zoom avant', accelerator: accelerator('zoomIn'), click: cmd('view:zoomIn') },
        { label: 'Zoom arrière', accelerator: accelerator('zoomOut'), click: cmd('view:zoomOut') },
        { label: 'Ajuster à la fenêtre', accelerator: accelerator('fit'), click: cmd('view:fit') },
        { type: 'separator' },
        {
          label: 'Afficher les noms de ports',
          type: 'checkbox',
          checked: state.showPortLabels,
          click: cmd('view:togglePortLabels')
        },
        {
          label: 'Afficher le panneau des propriétés',
          type: 'checkbox',
          checked: state.showProperties,
          click: cmd('view:toggleProperties')
        },
        {
          label: 'Afficher la minimap',
          type: 'checkbox',
          checked: state.showMinimap,
          click: cmd('view:toggleMinimap')
        },
        { type: 'separator' },
        {
          label: 'Thème',
          submenu: (
            [
              ['system', 'Système'],
              ['dark', 'Sombre'],
              ['light', 'Clair']
            ] as const
          ).map(([preference, label]) => ({
            label,
            type: 'radio' as const,
            checked: ctx.theme === preference,
            click: () => ctx.onTheme(preference)
          }))
        },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen', accelerator: accelerator('fullScreen') },
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { label: 'Recharger', role: 'reload' },
              { label: 'Outils de développement', role: 'toggleDevTools' }
            ] satisfies MenuItemConstructorOptions[]))
      ]
    },
    {
      label: '&Simulation',
      submenu: [
        {
          label: 'Mode Temps réel',
          type: 'radio',
          checked: state.mode === 'realtime',
          accelerator: accelerator('realtime'),
          click: cmd('sim:realtime')
        },
        {
          label: 'Mode Simulation',
          type: 'radio',
          checked: state.mode === 'simulation',
          accelerator: accelerator('simulation'),
          click: cmd('sim:simulation')
        },
        { type: 'separator' },
        {
          label: 'Avancer d’un pas',
          accelerator: accelerator('step'),
          enabled: state.mode === 'simulation',
          click: cmd('sim:step')
        },
        {
          label: 'Lecture automatique',
          accelerator: accelerator('play'),
          enabled: state.mode === 'simulation',
          click: cmd('sim:play')
        },
        {
          label: 'Réinitialiser la simulation',
          accelerator: accelerator('reset'),
          enabled: state.mode === 'simulation',
          click: cmd('sim:reset')
        }
      ]
    },
    {
      label: 'Aid&e',
      submenu: [
        { label: 'Guide de démarrage', accelerator: accelerator('guide'), click: cmd('help:guide') },
        { label: 'Raccourcis clavier', click: cmd('help:shortcuts') },
        ...(ctx.onCheckUpdates
          ? ([
              { label: 'Rechercher des mises à jour…', click: ctx.onCheckUpdates }
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { type: 'separator' },
        {
          label: 'À propos de ServerLab',
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: 'À propos de ServerLab',
              message: `ServerLab ${app.getVersion()}`,
              detail:
                'Simulateur pédagogique d’administration de serveurs (AD DS, DNS, DHCP, GPO, partages).\n' +
                'Tout est simulé : aucune machine virtuelle, aucune commande système exécutée.\n\n' +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\n` +
                'Projet indépendant, sans affiliation avec un éditeur de logiciels.'
            })
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

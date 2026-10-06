/**
 * Barre de menu native en français.
 * Les actions métier sont déléguées au renderer via le canal IPC `menu:command`.
 */
import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand, type MenuState, type RecentFile, type Theme } from '../shared/ipc'

export interface MenuContext {
  window: BrowserWindow
  state: MenuState
  recent: RecentFile[]
  theme: Theme
  onTheme: (theme: Theme) => void
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
        { label: 'Nouveau', accelerator: 'CmdOrCtrl+N', click: cmd('file:new') },
        { label: 'Ouvrir…', accelerator: 'CmdOrCtrl+O', click: cmd('file:open') },
        { label: 'Fichiers récents', submenu: recentItems },
        { type: 'separator' },
        { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: cmd('file:save') },
        { label: 'Enregistrer sous…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('file:saveAs') },
        { type: 'separator' },
        { label: 'Ouvrir un lab…', accelerator: 'CmdOrCtrl+L', click: cmd('file:openLab') },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', click: () => win.close() }
      ]
    },
    {
      label: '&Édition',
      submenu: [
        {
          label: state.undoLabel ?? 'Annuler',
          enabled: state.undoLabel !== null,
          ...displayOnly('CmdOrCtrl+Z'),
          click: cmd('edit:undo')
        },
        {
          label: state.redoLabel ?? 'Rétablir',
          enabled: state.redoLabel !== null,
          ...displayOnly('CmdOrCtrl+Y'),
          click: cmd('edit:redo')
        },
        { type: 'separator' },
        { label: 'Copier', ...displayOnly('CmdOrCtrl+C'), click: cmd('edit:copy') },
        { label: 'Coller', ...displayOnly('CmdOrCtrl+V'), click: cmd('edit:paste') },
        { label: 'Supprimer', ...displayOnly('Delete'), click: cmd('edit:delete') },
        { type: 'separator' },
        { label: 'Tout sélectionner', ...displayOnly('CmdOrCtrl+A'), click: cmd('edit:selectAll') }
      ]
    },
    {
      label: '&Affichage',
      submenu: [
        { label: 'Zoom avant', accelerator: 'CmdOrCtrl+=', click: cmd('view:zoomIn') },
        { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', click: cmd('view:zoomOut') },
        { label: 'Ajuster à la fenêtre', accelerator: 'CmdOrCtrl+0', click: cmd('view:fit') },
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
          label: 'Thème sombre',
          type: 'radio',
          checked: ctx.theme === 'dark',
          click: () => ctx.onTheme('dark')
        },
        {
          label: 'Thème clair',
          type: 'radio',
          checked: ctx.theme === 'light',
          click: () => ctx.onTheme('light')
        },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
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
          accelerator: 'CmdOrCtrl+1',
          click: cmd('sim:realtime')
        },
        {
          label: 'Mode Simulation',
          type: 'radio',
          checked: state.mode === 'simulation',
          accelerator: 'CmdOrCtrl+2',
          click: cmd('sim:simulation')
        },
        { type: 'separator' },
        {
          label: 'Avancer d’un pas',
          accelerator: 'F6',
          enabled: state.mode === 'simulation',
          click: cmd('sim:step')
        },
        {
          label: 'Lecture automatique',
          accelerator: 'F7',
          enabled: state.mode === 'simulation',
          click: cmd('sim:play')
        },
        {
          label: 'Réinitialiser la simulation',
          accelerator: 'F8',
          enabled: state.mode === 'simulation',
          click: cmd('sim:reset')
        }
      ]
    },
    {
      label: 'Aid&e',
      submenu: [
        { label: 'Guide de démarrage', accelerator: 'F1', click: cmd('help:guide') },
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

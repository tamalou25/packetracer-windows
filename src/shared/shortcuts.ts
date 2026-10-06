/**
 * Catalogue unique des raccourcis clavier : le menu natif (process principal) y prend ses
 * accélérateurs et l'aide « Raccourcis clavier » l'affiche en entier ; les deux ne peuvent pas
 * diverger. Les touches sont au format des accélérateurs Electron (CmdOrCtrl+Shift+S, F6, Delete).
 */

export type ShortcutGroup = 'Fichier' | 'Édition' | 'Outils du canvas' | 'Affichage' | 'Simulation' | 'Aide'

export interface Shortcut {
  /** Touches équivalentes ; la première est celle affichée dans le menu. */
  keys: readonly string[]
  label: string
  group: ShortcutGroup
}

export const SHORTCUTS = {
  newFile: { keys: ['CmdOrCtrl+N'], label: 'Nouveau', group: 'Fichier' },
  open: { keys: ['CmdOrCtrl+O'], label: 'Ouvrir…', group: 'Fichier' },
  save: { keys: ['CmdOrCtrl+S'], label: 'Enregistrer', group: 'Fichier' },
  saveAs: { keys: ['CmdOrCtrl+Shift+S'], label: 'Enregistrer sous…', group: 'Fichier' },
  openLab: { keys: ['CmdOrCtrl+L'], label: 'Ouvrir un lab…', group: 'Fichier' },
  quit: { keys: ['CmdOrCtrl+Q'], label: 'Quitter', group: 'Fichier' },

  undo: { keys: ['CmdOrCtrl+Z'], label: 'Annuler (aussi dans une console, ligne vide)', group: 'Édition' },
  redo: { keys: ['CmdOrCtrl+Y', 'CmdOrCtrl+Shift+Z'], label: 'Rétablir', group: 'Édition' },
  copy: { keys: ['CmdOrCtrl+C'], label: 'Copier les équipements sélectionnés', group: 'Édition' },
  paste: { keys: ['CmdOrCtrl+V'], label: 'Coller', group: 'Édition' },
  delete: {
    keys: ['Delete'],
    label: 'Supprimer la sélection (sans sélection : outil Supprimer)',
    group: 'Édition'
  },
  selectAll: { keys: ['CmdOrCtrl+A'], label: 'Tout sélectionner', group: 'Édition' },

  toolSelect: { keys: ['V'], label: 'Outil Sélection', group: 'Outils du canvas' },
  toolCable: { keys: ['C'], label: 'Outil Câble', group: 'Outils du canvas' },
  toolPdu: { keys: ['P'], label: 'Outil PDU simple', group: 'Outils du canvas' },
  cancel: {
    keys: ['Escape'],
    label: 'Annuler le câblage, revenir à l’outil Sélection',
    group: 'Outils du canvas'
  },

  zoomIn: { keys: ['CmdOrCtrl+='], label: 'Zoom avant (aussi : molette)', group: 'Affichage' },
  zoomOut: { keys: ['CmdOrCtrl+-'], label: 'Zoom arrière (aussi : molette)', group: 'Affichage' },
  fit: { keys: ['CmdOrCtrl+0'], label: 'Ajuster à la fenêtre', group: 'Affichage' },
  fullScreen: { keys: ['F11'], label: 'Plein écran', group: 'Affichage' },

  realtime: { keys: ['CmdOrCtrl+1'], label: 'Mode Temps réel', group: 'Simulation' },
  simulation: { keys: ['CmdOrCtrl+2'], label: 'Mode Simulation', group: 'Simulation' },
  step: { keys: ['F6'], label: 'Simulation : avancer d’un pas', group: 'Simulation' },
  play: { keys: ['F7'], label: 'Simulation : lecture automatique', group: 'Simulation' },
  reset: { keys: ['F8'], label: 'Simulation : réinitialiser', group: 'Simulation' },

  guide: { keys: ['F1'], label: 'Guide de démarrage', group: 'Aide' }
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

/** Ordre d'affichage des groupes dans l'aide. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'Fichier',
  'Édition',
  'Outils du canvas',
  'Affichage',
  'Simulation',
  'Aide'
]

/** Accélérateur du menu natif pour un raccourci (première touche). */
export function accelerator(id: ShortcutId): string {
  return SHORTCUTS[id].keys[0]
}

const KEY_NAMES: Record<string, string> = {
  CmdOrCtrl: 'Ctrl',
  Shift: 'Maj',
  Alt: 'Alt',
  Delete: 'Suppr',
  Escape: 'Échap'
}

/** Touche lisible en français : « CmdOrCtrl+Shift+S » → « Ctrl+Maj+S ». */
export function formatShortcut(key: string): string {
  return key
    .split('+')
    .map((part) => KEY_NAMES[part] ?? part)
    .join('+')
}

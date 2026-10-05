/**
 * Papiers peints du Bureau simulé : images intégrées au système (dégradés originaux) et
 * résolution du paramètre de stratégie « Papier peint du Bureau ».
 */
import type { CSSProperties } from 'react'
import type { WallpaperPolicy } from '@engine/index'

/** Dossier des images intégrées, présent sur chaque ordinateur simulé. */
export const WALLPAPER_DIR = 'C:\\Windows\\Web\\Wallpaper\\ServerLab'

export const BUILTIN_WALLPAPERS: Record<string, { label: string; image: string }> = {
  'aurore.jpg': {
    label: 'Aurore',
    image:
      'radial-gradient(ellipse at 20% 85%, rgba(46,204,140,0.6), transparent 55%), radial-gradient(ellipse at 75% 25%, rgba(64,156,255,0.55), transparent 60%), linear-gradient(180deg, #06121f, #0c2a45)'
  },
  'ocean.jpg': {
    label: 'Océan',
    image: 'linear-gradient(180deg, #a7d8f2 0%, #3d8fc4 45%, #0d4a7a 75%, #062a46 100%)'
  },
  'foret.jpg': {
    label: 'Forêt',
    image: 'linear-gradient(180deg, #dce9c8 0%, #7fa65a 40%, #2f5a2c 75%, #14301a 100%)'
  },
  'desert.jpg': {
    label: 'Désert',
    image: 'linear-gradient(180deg, #f6d6a8 0%, #e8a964 45%, #b5653a 75%, #5e2f1f 100%)'
  },
  'nuit.jpg': {
    label: 'Nuit',
    image:
      'radial-gradient(circle at 78% 22%, #f5f3ce 0 2.5%, transparent 3%), linear-gradient(180deg, #0b1026 0%, #1b1f4a 60%, #2b2560 100%)'
  }
}

/** Fond par défaut du Bureau (aucune stratégie). */
export const DEFAULT_WALLPAPER =
  'radial-gradient(ellipse at 70% 25%, #2f78c4 0%, #174a86 38%, #0c2a52 72%, #071a35 100%)'

export interface DesktopBackground {
  style: CSSProperties
  /** Identifiant pour les tests : default, black ou nom de l'image intégrée. */
  id: string
}

/** Image intégrée désignée par un chemin local (C:\Windows\Web\Wallpaper\ServerLab\aurore.jpg). */
function builtinFor(path: string): string | null {
  const normalized = path.trim().replace(/\//g, '\\').toLowerCase()
  const dir = `${WALLPAPER_DIR.toLowerCase()}\\`
  if (!normalized.startsWith(dir)) return null
  const file = normalized.slice(dir.length)
  return file in BUILTIN_WALLPAPERS ? file : null
}

/**
 * Fond du Bureau selon la stratégie : image intégrée, ou fond noir si l'image est introuvable
 * (chemin inexistant ou inaccessible : comportement réel du paramètre).
 */
export function desktopBackground(policy: WallpaperPolicy | undefined): DesktopBackground {
  if (!policy || policy.state !== 'Enabled')
    return { style: { backgroundImage: DEFAULT_WALLPAPER }, id: 'default' }
  const file = builtinFor(policy.path)
  const image = file ? BUILTIN_WALLPAPERS[file]?.image : undefined
  if (!file || !image) return { style: { backgroundColor: '#000000' }, id: 'black' }
  const id = file.replace(/\.jpg$/, '')
  switch (policy.style) {
    case 'Center':
      return {
        style: {
          backgroundColor: '#000000',
          backgroundImage: image,
          backgroundSize: '55% 55%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        },
        id
      }
    case 'Tile':
      return { style: { backgroundImage: image, backgroundSize: '25% 25%', backgroundRepeat: 'repeat' }, id }
    default:
      return { style: { backgroundImage: image, backgroundSize: 'cover' }, id }
  }
}

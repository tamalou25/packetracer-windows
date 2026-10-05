/**
 * Horloge simulée : le temps du lab part du lundi 5 janvier 2026 à 8 h.
 * Les fonctions de formatage sont déterministes (pas d'accès à l'horloge système).
 */

export const LAB_EPOCH_MS = Date.UTC(2026, 0, 5, 8, 0, 0)

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre'
]

function parts(clock: number) {
  const d = new Date(LAB_EPOCH_MS + clock)
  return {
    day: d.getUTCDay(),
    date: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    s: d.getUTCSeconds()
  }
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** « lundi 5 janvier 2026 08:00:00 » (format d'ipconfig /all). */
export function formatLongDate(clock: number): string {
  const t = parts(clock)
  return `${DAYS[t.day]} ${t.date} ${MONTHS[t.month]} ${t.year} ${p2(t.h)}:${p2(t.m)}:${p2(t.s)}`
}

/** « 05/01/2026 08:00:00 ». */
export function formatShortDate(clock: number): string {
  const t = parts(clock)
  return `${p2(t.date)}/${p2(t.month + 1)}/${t.year} ${p2(t.h)}:${p2(t.m)}:${p2(t.s)}`
}

/** Éléments d'horloge pour l'affichage (barre des tâches, écran de verrouillage). */
export function formatClockParts(clock: number): { time: string; date: string; longDate: string } {
  const t = parts(clock)
  return {
    time: `${p2(t.h)}:${p2(t.m)}`,
    date: `${p2(t.date)}/${p2(t.month + 1)}/${t.year}`,
    longDate: `${DAYS[t.day]} ${t.date} ${MONTHS[t.month]}`
  }
}

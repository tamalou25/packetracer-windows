/**
 * Formats d'affichage (dates simulées…).
 */

/** Date de départ de l'horloge simulée d'un lab (lundi 5 janvier 2026, 8 h). */
const LAB_EPOCH = Date.UTC(2026, 0, 5, 8, 0, 0)

/** Date et heure simulées, au format français. */
export function formatSimTime(clock: number): string {
  const d = new Date(LAB_EPOCH + clock)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

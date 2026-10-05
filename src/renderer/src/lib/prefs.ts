/**
 * Petites préférences d'affichage propres au poste (panneaux repliés…), dans le localStorage.
 * Le stockage peut être indisponible : on retombe alors silencieusement sur la valeur par défaut.
 */
const PREFIX = 'serverlab.'

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    // Même forme que la valeur par défaut (type primitif ou objet), sinon ignorée
    if (typeof value !== typeof fallback || (value === null) !== (fallback === null)) return fallback
    if (typeof fallback === 'object' && fallback !== null)
      return { ...fallback, ...(value as Partial<T>) } as T
    return value as T
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Préférence non mémorisée : sans conséquence
  }
}

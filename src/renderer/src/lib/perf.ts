/**
 * Instrumentation de mesure, inactive par défaut : quand un test de performance pose
 * `window.serverlabPerf = { renders: {} }`, les composants du canvas y comptent leurs rendus.
 */
interface PerfProbe {
  renders: Record<string, number>
}

/** Compte un rendu (clé : « node:<id> », « edge:<id> »…) si la mesure est active. */
export function countRender(key: string): void {
  const probe = (window as { serverlabPerf?: PerfProbe }).serverlabPerf
  if (probe) probe.renders[key] = (probe.renders[key] ?? 0) + 1
}

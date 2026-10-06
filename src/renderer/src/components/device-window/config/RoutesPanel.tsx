/**
 * Routage statique d'un routeur et table de routage effective.
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { prefixToMask, routingTable, type RouterDevice, command } from '@engine/index'
import { useLabStore } from '../../../store/lab'
import { useUiStore } from '../../../store/ui'
import { runCommand } from '../../../lib/run'
import { Button, Section, inputClass } from '../../common/ui'

const SOURCE_LABEL = { connected: 'C', static: 'S', default: 'S*' } as const

export function RoutesPanel({ device }: { device: RouterDevice }) {
  const lab = useLabStore((s) => s.lab)
  const [network, setNetwork] = useState('')
  const [mask, setMask] = useState('')
  const [nextHop, setNextHop] = useState('')
  const table = routingTable(lab, device)

  const add = () => {
    const result = runCommand(command('net.addStaticRoute', device.id, { network, mask, nextHop }))
    if (!result) return
    result.warnings.forEach((w) => useUiStore.getState().notify('warning', w))
    setNetwork('')
    setMask('')
    setNextHop('')
  }

  return (
    <>
      <Section title="Routes statiques">
        <table className="mb-3 w-full max-w-xl text-xs">
          <thead className="text-left text-fg-muted">
            <tr>
              <th className="py-1">Réseau</th>
              <th className="py-1">Masque</th>
              <th className="py-1">Prochain saut</th>
              <th />
            </tr>
          </thead>
          <tbody className="font-mono">
            {device.routes.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 font-sans text-fg-subtle">
                  Aucune route statique.
                </td>
              </tr>
            )}
            {device.routes.map((r, i) => (
              <tr key={`${r.network}/${r.prefixLength}-${r.nextHop}`} className="border-t border-line">
                <td className="py-1">{r.network}</td>
                <td className="py-1">{prefixToMask(r.prefixLength)}</td>
                <td className="py-1">{r.nextHop}</td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    className="rounded p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger"
                    title="Supprimer la route"
                    onClick={() => runCommand(command('net.removeStaticRoute', device.id, i))}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid max-w-xl grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
          <input
            className={inputClass}
            placeholder="Réseau (192.168.2.0)"
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Masque (255.255.255.0)"
            value={mask}
            onChange={(e) => setMask(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Prochain saut"
            value={nextHop}
            onChange={(e) => setNextHop(e.target.value)}
          />
          <Button variant="primary" onClick={add}>
            Ajouter
          </Button>
        </div>
        <p className="mt-2 text-xs text-fg-muted">Route par défaut : réseau 0.0.0.0, masque 0.0.0.0.</p>
      </Section>
      <Section title="Table de routage">
        <pre className="selectable rounded border border-line bg-app p-3 font-mono text-[11px] leading-5 text-fg">
          {table.length === 0
            ? 'Aucune route (aucune interface configurée).'
            : table
                .map((r) => {
                  const code = SOURCE_LABEL[r.source].padEnd(3)
                  const iface = device.interfaces.find((i) => i.id === r.ifaceId)?.name ?? ''
                  return r.gateway
                    ? `${code} ${r.network}/${r.prefixLength} via ${r.gateway}, ${iface}`
                    : `${code} ${r.network}/${r.prefixLength} directement connecté, ${iface}`
                })
                .join('\n')}
        </pre>
      </Section>
    </>
  )
}

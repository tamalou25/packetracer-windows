/**
 * « Ce PC » : disque local et lecteurs réseau mappés par les préférences de stratégie de groupe.
 */
import { HardDrive, Network, type LucideIcon } from 'lucide-react'
import type { HostDevice } from '@engine/index'
import { mappedDrives } from '../../../lib/policy'

/** « \\SRV1\Commun » → { server: 'SRV1', share: 'Commun' }. */
function splitUnc(path: string): { server: string; share: string } {
  const [server = '', share = ''] = path.replace(/^\\\\/, '').split('\\')
  return { server, share }
}

function DriveTile({
  icon: Icon,
  label,
  detail,
  testId
}: {
  icon: LucideIcon
  label: string
  detail: string
  testId: string
}) {
  return (
    <div className="flex w-64 items-center gap-3 rounded-sm p-2 hover:bg-[#e5f3ff]" data-testid={testId}>
      <Icon size={30} strokeWidth={1.3} className="shrink-0 text-slate-500" />
      <div className="min-w-0">
        <div className="truncate">{label}</div>
        <div className="truncate text-[11px] text-[#6d6d6d]">{detail}</div>
      </div>
    </div>
  )
}

export function ThisPc({ device }: { device: HostDevice }) {
  const drives = mappedDrives(device)
  return (
    <div className="flex h-full flex-col bg-white text-xs text-black" data-testid="thispc">
      <div className="flex h-8 shrink-0 items-center border-b border-[#e5e5e5] px-3 text-[#333]">
        <span className="rounded-sm border border-[#d9d9d9] px-2 py-0.5">› Ce PC</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h3 className="mb-1 text-[13px] text-[#1e3287]">Périphériques et lecteurs (1)</h3>
        <div className="mb-4 flex flex-wrap gap-2">
          <DriveTile
            icon={HardDrive}
            label="Disque local (C:)"
            detail={device.kind === 'server' ? '41,6 Go libres sur 59,3 Go' : '33,9 Go libres sur 49,4 Go'}
            testId="drive-C"
          />
        </div>
        <h3 className="mb-1 text-[13px] text-[#1e3287]">Emplacements réseau ({drives.length})</h3>
        {drives.length === 0 ? (
          <p className="text-[#6d6d6d]">Aucun lecteur réseau connecté.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {drives.map((d) => {
              const { server, share } = splitUnc(d.path)
              return (
                <DriveTile
                  key={d.letter}
                  icon={Network}
                  label={`${d.label || share} (\\\\${server}) (${d.letter}:)`}
                  detail={d.path}
                  testId={`drive-${d.letter}`}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

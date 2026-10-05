/**
 * Panneau de configuration (affichage par catégorie) : Système et sécurité, Réseau et Internet,
 * Comptes d'utilisateurs. Les liens ouvrent les mêmes applications que le menu Démarrer.
 */
import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Network,
  Search,
  ShieldCheck,
  UserRound
} from 'lucide-react'
import type { HostDevice } from '@engine/index'
import { launch } from '../../../lib/desktop'
import { hostNetwork } from '../../../lib/netstatus'
import { useLabStore } from '../../../store/lab'
import { DESKTOP_APPS } from '../apps'
import { NetworkGlyph } from '../shell/Taskbar'

type Page = 'home' | 'admin' | 'network' | 'accounts'

const TITLES: Record<Page, string[]> = {
  home: ['Panneau de configuration'],
  admin: ['Panneau de configuration', 'Système et sécurité', 'Outils d’administration'],
  network: ['Panneau de configuration', 'Réseau et Internet', 'Centre Réseau et partage'],
  accounts: ['Panneau de configuration', 'Comptes d’utilisateurs']
}

function Link({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-[#0066cc] hover:underline"
      data-testid={testId}
    >
      {children}
    </button>
  )
}

export function ControlPanel({ device }: { device: HostDevice }) {
  const [page, setPage] = useState<Page>('home')
  const lab = useLabStore((s) => s.lab)
  const open = (appId: string) => launch(device.id, appId)

  return (
    <div className="flex h-full flex-col bg-white text-xs text-black" data-testid="control-panel">
      <div className="flex items-center gap-1 border-b border-[#e5e5e5] px-2 py-1.5 text-[#6d6d6d]">
        <button
          type="button"
          onClick={() => setPage('home')}
          disabled={page === 'home'}
          className="disabled:opacity-40"
        >
          <ArrowLeft size={14} />
        </button>
        <ArrowRight size={14} />
        <ArrowUp size={14} />
        <div className="ml-2 flex flex-1 items-center gap-1 border border-[#d9d9d9] px-2 py-0.5 text-black">
          {TITLES[page].map((t, i) => (
            <span key={t} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} />}
              {t}
            </span>
          ))}
        </div>
        <div className="flex w-48 items-center gap-1 border border-[#d9d9d9] px-2 py-0.5 text-[#999]">
          <Search size={12} /> Rechercher dans le Panneau de configuration
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {page === 'home' && (
          <>
            <h2 className="mb-5 text-lg font-light text-[#1e3287]">Ajuster les paramètres de l’ordinateur</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="flex gap-3">
                <ShieldCheck size={40} className="shrink-0 text-[#1e6fbf]" strokeWidth={1.3} />
                <div className="flex flex-col gap-1">
                  <Link onClick={() => open('sysdm')} testId="cp-system">
                    <span className="text-sm">Système et sécurité</span>
                  </Link>
                  <Link onClick={() => open('sysdm')}>Système</Link>
                  <Link onClick={() => setPage('admin')} testId="cp-admin">
                    Outils d’administration
                  </Link>
                  <Link onClick={() => open('eventvwr')}>Afficher les journaux d’événements</Link>
                </div>
              </div>
              <div className="flex gap-3">
                <Network size={40} className="shrink-0 text-emerald-600" strokeWidth={1.3} />
                <div className="flex flex-col gap-1">
                  <Link onClick={() => setPage('network')} testId="cp-network">
                    <span className="text-sm">Réseau et Internet</span>
                  </Link>
                  <Link onClick={() => setPage('network')}>Afficher l’état et la gestion du réseau</Link>
                  <Link onClick={() => open('ncpa')} testId="cp-ncpa">
                    Modifier les paramètres de la carte
                  </Link>
                </div>
              </div>
              <div className="flex gap-3">
                <UserRound size={40} className="shrink-0 text-amber-600" strokeWidth={1.3} />
                <div className="flex flex-col gap-1">
                  <Link onClick={() => setPage('accounts')}>
                    <span className="text-sm">Comptes d’utilisateurs</span>
                  </Link>
                  <Link onClick={() => setPage('accounts')}>Afficher le compte connecté</Link>
                </div>
              </div>
            </div>
          </>
        )}
        {page === 'admin' && (
          <>
            <h2 className="mb-3 text-lg font-light text-[#1e3287]">Outils d’administration</h2>
            <ul className="flex flex-col gap-1">
              {DESKTOP_APPS.filter((a) => (a.tool || a.start === 'admin') && a.available(device)).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => open(a.id)}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-[#e5f3ff]"
                  >
                    <a.icon size={16} className={a.color} /> {a.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {page === 'network' && (
          <>
            <h2 className="mb-3 text-lg font-light text-[#1e3287]">
              Afficher les informations de base de votre réseau et configurer des connexions
            </h2>
            <div className="mb-2 text-[#555]">Afficher vos réseaux actifs</div>
            {hostNetwork(lab, device).adapters.map((a) => (
              <div key={a.iface.id} className="mb-2 flex items-center gap-4 border-t border-[#e5e5e5] pt-2">
                <NetworkGlyph state={a.state} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{a.network || a.label}</div>
                  <div className="text-[#555]">
                    {a.state === 'internet' ? 'Réseau de domaine ou privé' : 'Réseau public'}
                  </div>
                </div>
                <div className="grid grid-cols-[110px_1fr] gap-x-2">
                  <span className="text-[#555]">Type d’accès :</span>
                  <span>{a.connectivity}</span>
                  <span className="text-[#555]">Connexions :</span>
                  <Link onClick={() => launch(device.id, 'netstatus', { arg: a.iface.id })}>
                    {a.iface.name}
                  </Link>
                </div>
              </div>
            ))}
            <Link onClick={() => open('ncpa')}>Modifier les paramètres de la carte</Link>
          </>
        )}
        {page === 'accounts' && (
          <>
            <h2 className="mb-3 text-lg font-light text-[#1e3287]">
              Apporter des modifications à votre compte
            </h2>
            <div className="flex items-center gap-3">
              <UserRound size={48} className="text-[#777]" strokeWidth={1.2} />
              <div>
                <div className="text-sm font-semibold">{device.host.session?.user ?? '—'}</div>
                <div className="text-[#555]">
                  {device.host.session?.domain
                    ? `Compte du domaine ${device.host.session.domain}`
                    : `Compte local de ${device.name}`}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Contenu des fenêtres du Bureau simulé selon l'application.
 */
import type { ReactNode } from 'react'
import type { HostDevice } from '@engine/index'
import type { DesktopWindow } from '../../store/desktop'
import { AducApp } from '../apps/AducApp'
import { DhcpApp } from '../apps/DhcpApp'
import { DnsApp } from '../apps/DnsApp'
import { Terminal } from '../console/Terminal'
import { AddRolesWizard } from './apps/AddRolesWizard'
import { ControlPanel } from './apps/ControlPanel'
import { DhcpPostInstall } from './apps/DhcpPostInstall'
import { EventViewer } from './apps/EventViewer'
import {
  AdapterPropertiesDialog,
  AdapterStatusDialog,
  Ipv4PropertiesDialog,
  NetDetailsDialog,
  NetworkConnections
} from './apps/Network'
import { PromoteWizard } from './apps/PromoteWizard'
import { RecycleBin } from './apps/RecycleBin'
import { RunDialog } from './apps/RunDialog'
import { ServerManager } from './apps/ServerManager'
import { ComputerNameDialog, SystemProperties } from './apps/System'

function unavailable(): ReactNode {
  return <div className="p-6 text-sm text-slate-500">Application indisponible sur cet ordinateur.</div>
}

export function renderApp(win: DesktopWindow, device: HostDevice): ReactNode {
  const server = device.kind === 'server' ? device : null
  switch (win.app) {
    case 'servermanager':
      return server ? <ServerManager device={server} /> : unavailable()
    case 'powershell':
      return <Terminal deviceId={device.id} kind="powershell" autoFocus />
    case 'cmd':
      return <Terminal deviceId={device.id} kind="cmd" autoFocus />
    case 'ncpa':
      return <NetworkConnections device={device} />
    case 'netstatus':
      return <AdapterStatusDialog device={device} ifaceId={win.arg} />
    case 'netprops':
      return <AdapterPropertiesDialog device={device} ifaceId={win.arg} />
    case 'netdetails':
      return <NetDetailsDialog device={device} ifaceId={win.arg} />
    case 'ipv4':
      return <Ipv4PropertiesDialog device={device} ifaceId={win.arg} />
    case 'sysdm':
      return <SystemProperties device={device} />
    case 'sysdmname':
      return <ComputerNameDialog device={device} />
    case 'control':
      return <ControlPanel device={device} />
    case 'eventvwr':
      return <EventViewer device={device} />
    case 'dhcp':
      return server ? <DhcpApp device={server} /> : unavailable()
    case 'dns':
      return server ? <DnsApp device={server} /> : unavailable()
    case 'aduc':
      return <AducApp device={device} />
    case 'run':
      return <RunDialog device={device} />
    case 'addroles':
      return server ? (
        <AddRolesWizard device={server} mode={win.arg === 'remove' ? 'remove' : 'install'} />
      ) : (
        unavailable()
      )
    case 'adpromote':
      return server ? <PromoteWizard device={server} /> : unavailable()
    case 'dhcppost':
      return server ? <DhcpPostInstall device={server} /> : unavailable()
    case 'recycle':
      return <RecycleBin />
    default:
      return unavailable()
  }
}

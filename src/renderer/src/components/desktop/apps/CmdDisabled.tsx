/**
 * Invite de commandes interdite par stratégie de groupe : message, puis fermeture à la
 * première touche, comme le vrai comportement de cmd.exe.
 */
import { useEffect, useRef } from 'react'
import { CMD_DISABLED_LINES } from '@engine/index'
import { useAppWindow } from '../shell/AppWindow'

export function CmdDisabled() {
  const win = useAppWindow()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={() => win?.close()}
      className="h-full bg-black p-2 font-mono text-[13px] leading-[1.35] text-neutral-300 outline-none"
      data-testid="cmd-disabled"
    >
      {CMD_DISABLED_LINES.map((line, i) => (
        <div key={i} className="min-h-[1.35em]">
          {line}
        </div>
      ))}
    </div>
  )
}

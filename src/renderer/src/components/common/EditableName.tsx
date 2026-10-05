/**
 * Champ de nom validé à la perte de focus ou avec Entrée.
 */
import { useEffect, useState } from 'react'
import { command } from '@engine/index'
import { runCommand } from '../../lib/run'
import { inputClass } from './ui'

export function EditableName({ deviceId, name }: { deviceId: string; name: string }) {
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])

  const commit = () => {
    if (value.trim() === name) {
      setValue(name)
      return
    }
    const ok = runCommand(command('topology.renameDevice', deviceId, value)) !== undefined
    if (!ok) setValue(name)
  }

  return (
    <input
      className={inputClass}
      value={value}
      data-testid="device-name-input"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(name)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

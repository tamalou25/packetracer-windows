/**
 * Boîte de dialogue modale applicative (alerte ou confirmation).
 */
import { useEffect } from 'react'
import { useUiStore } from '../../store/ui'
import { Button } from './ui'

export function Modal() {
  const modal = useUiStore((s) => s.modal)
  const close = () => useUiStore.getState().showModal(null)

  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        modal.onCancel?.()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  if (!modal) return null
  const isConfirm = !!modal.onConfirm
  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[440px] rounded-xl bg-white p-5 shadow-2xl" data-testid="modal">
        <h2 className="mb-2 text-base font-semibold text-slate-800">{modal.title}</h2>
        <p className="selectable mb-5 text-sm whitespace-pre-line text-slate-600">{modal.message}</p>
        <div className="flex justify-end gap-2">
          {isConfirm && (
            <Button
              onClick={() => {
                modal.onCancel?.()
                close()
              }}
            >
              {modal.cancelLabel ?? 'Annuler'}
            </Button>
          )}
          <Button
            variant="primary"
            data-testid="modal-confirm"
            onClick={() => {
              modal.onConfirm?.()
              close()
            }}
          >
            {modal.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </div>
    </div>
  )
}

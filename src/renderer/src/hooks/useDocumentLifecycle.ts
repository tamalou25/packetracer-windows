/**
 * Cycle de vie du document : titre de la fenêtre, autosave (60 s), fichier au démarrage,
 * ouverture depuis l'extérieur et enregistrement avant fermeture.
 */
import { useEffect } from 'react'
import { openExternalDocument, saveDocument, serializeCurrent, startupDocument } from '../lib/document'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'

export const AUTOSAVE_INTERVAL_MS = 60_000

export function useDocumentLifecycle(): void {
  const fileName = useLabStore((s) => s.fileName)
  const dirty = useLabStore((s) => s.dirty)

  // Titre de la fenêtre + état transmis au main (confirmation à la fermeture)
  useEffect(() => {
    document.title = `${fileName}${dirty ? ' *' : ''} — ServerLab`
    window.serverlab?.setDocumentState({ name: fileName, dirty })
  }, [fileName, dirty])

  useEffect(() => {
    const api = window.serverlab
    if (!api) return
    void api.appInfo().then((info) => useUiStore.getState().setAppVersion(info.version))
    void startupDocument()

    // Copie de récupération toutes les 60 s si le document a été modifié
    const timer = setInterval(() => {
      if (!useLabStore.getState().dirty) return
      void api.writeAutosave(serializeCurrent()).then(() => useUiStore.getState().setLastAutosave(Date.now()))
    }, AUTOSAVE_INTERVAL_MS)

    const offOpened = api.onFileOpened((file) => void openExternalDocument(file))
    const offClose = api.onCloseRequested(() => {
      void saveDocument().then((saved) => {
        if (saved) api.confirmClose()
      })
    })
    return () => {
      clearInterval(timer)
      offOpened()
      offClose()
    }
  }, [])
}

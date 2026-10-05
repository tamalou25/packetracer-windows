/**
 * Point d'entrée du renderer React.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './styles.css'
import { App } from './App'
import { applyThemeToDocument, initialTheme } from './store/ui'

// Thème appliqué avant le premier rendu (pas de flash de couleurs)
applyThemeToDocument(initialTheme())

const container = document.getElementById('root')
if (!container) throw new Error('Élément #root introuvable')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)

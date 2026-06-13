import React from 'react'
import ReactDOM from 'react-dom/client'
// HashRouter (URLs like /#/open) so deep links never 404 on GitHub Pages,
// which has no SPA server fallback. Invisible once installed as a PWA.
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './auth/AuthContext.jsx'
import { seedIfEmpty } from './db/database.js'
import { startSync } from './sync/syncEngine.js'

// Seed first-run defaults, then start the background sync engine.
seedIfEmpty()
  .catch((e) => console.error('Seed failed', e))
  .finally(() => startSync())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)

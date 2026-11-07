import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
      .then(async () => {
        await navigator.serviceWorker.ready
        const resources = performance.getEntriesByType('resource')
          .map(resource => new URL(resource.name))
          .filter(url => url.origin === window.location.origin && url.pathname !== '/sw.js')
          .map(url => `${url.pathname}${url.search}`)
        const cache = await caches.open('plumb-shell-v2')
        await cache.addAll([...new Set(resources)])
      })
      .catch(error => console.error('Plumb offline support could not be enabled.', error))
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

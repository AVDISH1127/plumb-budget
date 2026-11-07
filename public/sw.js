const CACHE_NAME = 'plumb-shell-v3'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/plumb-icon.svg',
  '/icons/plumb-192.png',
  '/icons/plumb-512.png',
  '/icons/plumb-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('plumb-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      const data = await event.request.formData()
      const file = data.get('media')
      if (file instanceof Blob && typeof file.arrayBuffer === 'function') {
        const cache = await caches.open(CACHE_NAME)
        await cache.put('/__shared-file__', new Response(await file.arrayBuffer(), {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Plumb-File-Name': typeof file === 'object' && 'name' in file ? String(file.name) : '',
          },
        }))
      }
      return Response.redirect('/?shared=1', 303)
    })())
  }
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
          }
          return response
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
      }
      return response
    }),
  )
})

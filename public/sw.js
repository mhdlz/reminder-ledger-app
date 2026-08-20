// Background Service Worker
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    return self.clients.claim();
});

self.addEventListener('push', (e) => {
    const data = e.data ? e.data.text() : '⏰ রিমাইন্ডারের সময় হয়েছে!';
    self.registration.showNotification('রিমাইন্ডার এলার্ম!', {
        body: data,
        icon: 'https://cdn-icons-png.flaticon.com/512/3602/3602145.png',
        vibrate: [500, 250, 500]
    });
});
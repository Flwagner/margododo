"use strict";

const CACHE='margododo-v2';
const ASSETS=[
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install',function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(cache){ return cache.addAll(ASSETS); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.map(function(k){ return k!==CACHE ? caches.delete(k) : null; })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET') return;
  e.respondWith(
    caches.match(e.request).then(function(hit){
      if(hit) return hit;
      return fetch(e.request).then(function(res){
        if(res.ok){
          const copy=res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request,copy); });
        }
        return res;
      });
    })
  );
});

self.addEventListener('notificationclick',function(e){
  e.notification.close();
  if(e.action==='stop'){
    e.waitUntil(
      clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
        for(const c of list){
          if('focus' in c){
            c.focus();
            c.postMessage({type:'stop'});
            return;
          }
        }
        return clients.openWindow('./');
      })
    );
    return;
  }
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
      for(const c of list){
        if('focus' in c) return c.focus();
      }
      return clients.openWindow('./');
    })
  );
});

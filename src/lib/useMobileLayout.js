import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 768px)';
const subscribers = new Set();
let mediaQueryList = null;

function getMediaQueryList() {
  if (mediaQueryList) return mediaQueryList;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  mediaQueryList = window.matchMedia(MOBILE_QUERY);
  return mediaQueryList;
}

function notifySubscribers() {
  subscribers.forEach(notify => notify());
}

function subscribe(notify) {
  const media = getMediaQueryList();
  subscribers.add(notify);
  if (subscribers.size === 1 && media) {
    if (typeof media.addEventListener === 'function') media.addEventListener('change', notifySubscribers);
    else media.addListener?.(notifySubscribers);
  }

  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && media) {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', notifySubscribers);
      else media.removeListener?.(notifySubscribers);
    }
  };
}

const getSnapshot = () => getMediaQueryList()?.matches ?? false;
const getServerSnapshot = () => false;

export default function useMobileLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

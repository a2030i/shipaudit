let toastHandler = null;

export function setToastHandler(handler) {
  toastHandler = handler;
}

export function toast(message, type = 'info') {
  toastHandler?.(message, type);
}

const AUTH_STORAGE_KEY = "flaredrive-webdav-auth";

export function getWebDavAuthHeader(): Record<string, string> {
  const auth = window.localStorage.getItem(AUTH_STORAGE_KEY);
  return auth ? { Authorization: auth } : {};
}

export function hasWebDavAuth() {
  return Boolean(window.localStorage.getItem(AUTH_STORAGE_KEY));
}

export function setWebDavCredentials(username: string, password: string) {
  window.localStorage.setItem(
    AUTH_STORAGE_KEY,
    `Basic ${window.btoa(`${username}:${password}`)}`
  );
}

export function clearWebDavCredentials() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

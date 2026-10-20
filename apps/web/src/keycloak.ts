import Keycloak from 'keycloak-js';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'budget-management',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT || 'budget-web',
});

export async function initKeycloak(): Promise<void> {
  await keycloak.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    checkLoginIframe: false,
  });
  window.setInterval(() => {
    keycloak.updateToken(30).catch(() => keycloak.login());
  }, 20000);
}

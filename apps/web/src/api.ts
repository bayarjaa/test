import axios from 'axios';
import { keycloak } from './keycloak';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
});

api.interceptors.request.use(async (config) => {
  if (keycloak.token) {
    await keycloak.updateToken(20).catch(() => keycloak.login());
    config.headers.Authorization = `Bearer ${keycloak.token}`;
  }
  return config;
});

export function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return 'Хүсэлт амжилтгүй';
}

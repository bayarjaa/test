import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import mnMN from 'antd/locale/mn_MN';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initKeycloak } from './keycloak';

const queryClient = new QueryClient();

initKeycloak()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <ConfigProvider locale={mnMN} theme={{ token: { colorPrimary: '#0f4c81', borderRadius: 8 } }}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ConfigProvider>,
    );
  })
  .catch((error: unknown) => {
    const root = document.getElementById('root');
    if (root) root.textContent = error instanceof Error ? error.message : 'Keycloak нэвтрэлт амжилтгүй';
  });

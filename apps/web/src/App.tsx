import {
  ApartmentOutlined,
  AuditOutlined,
  BankOutlined,
  DashboardOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Layout, Menu, Select, Typography } from 'antd';
import { useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { keycloak } from './keycloak';
import { mn } from './labels';
import { AccessPage } from './pages/AccessPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { ProfilePage } from './pages/ProfilePage';
import { StructurePage } from './pages/StructurePage';
import { UsersPage } from './pages/UsersPage';

const { Header, Sider, Content } = Layout;

export interface Membership {
  id: string;
  name: string;
  code?: string;
  orgType?: string;
  alias?: string;
  parentOrganizationId?: string;
}

export interface Me {
  keycloakId: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  activeOrganizationId?: string | null;
  organizations: Membership[];
  positions: Array<{
    organizationId: string;
    organizationName: string;
    positionId: string;
    positionName: string;
    riskLevel?: string;
    duties: string[];
    effectivePermissions: string[];
  }>;
}

export function App() {
  const location = useLocation();
  const me = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get<Me>('/api/me')).data });
  const [orgId, setOrgId] = useState<string>();
  const active = orgId || me.data?.activeOrganizationId || me.data?.organizations[0]?.id;

  async function changeOrg(value: string) {
    setOrgId(value);
    await api.post('/api/me/active-organization', { organizationId: value });
  }

  const items = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">{mn.dashboard}</Link> },
    { key: '/organizations', icon: <BankOutlined />, label: <Link to="/organizations">{mn.organizations}</Link> },
    { key: '/structure', icon: <ApartmentOutlined />, label: <Link to="/structure">{mn.structure}</Link> },
    { key: '/users', icon: <TeamOutlined />, label: <Link to="/users">{mn.users}</Link> },
    { key: '/permissions', icon: <SafetyCertificateOutlined />, label: <Link to="/permissions">{mn.permissions}</Link> },
    { key: '/budgets', icon: <AuditOutlined />, label: <Link to="/budgets">{mn.budgets}</Link> },
    { key: '/requests', icon: <SolutionOutlined />, label: <Link to="/requests">{mn.requests}</Link> },
    { key: '/profile', icon: <UserOutlined />, label: <Link to="/profile">{mn.profile}</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={248} theme="dark" style={{ background: '#0b2540' }}>
        <Typography.Title level={5} style={{ color: 'white', margin: 20 }}>
          {mn.app}
        </Typography.Title>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={items} style={{ background: '#0b2540' }} />
      </Sider>
      <Layout>
        <Header style={{ background: 'white', display: 'flex', gap: 16, alignItems: 'center', paddingInline: 24 }}>
          <span>{mn.activeOrg}</span>
          <Select
            style={{ minWidth: 280 }}
            value={active}
            onChange={changeOrg}
            options={(me.data?.organizations || []).map((org) => ({ value: org.id, label: `${org.name} (${org.code || ''})` }))}
          />
          <span style={{ marginLeft: 'auto' }}>
            {me.data?.firstName} {me.data?.lastName} ({me.data?.username})
          </span>
          <a onClick={() => keycloak.logout()}>{mn.logout}</a>
        </Header>
        <Content style={{ margin: 24 }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/structure" element={<StructurePage organizationId={active} />} />
            <Route path="/users" element={<UsersPage organizationId={active} />} />
            <Route path="/permissions" element={<PermissionsPage organizationId={active} />} />
            <Route path="/budgets" element={<BudgetsPage organizationId={active} />} />
            <Route path="/requests" element={<AccessPage organizationId={active} />} />
            <Route path="/profile" element={<ProfilePage me={me.data} onOrg={changeOrg} />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

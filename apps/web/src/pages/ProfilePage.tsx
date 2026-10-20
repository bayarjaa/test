import { useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Select, Tag } from 'antd';
import { api } from '../api';
import type { Me } from '../App';
import { label, mn } from '../labels';

export function ProfilePage({ me, onOrg }: { me?: Me; onOrg: (id: string) => void }) {
  const orgId = me?.activeOrganizationId || me?.organizations[0]?.id;
  const permissions = useQuery({
    queryKey: ['effective', orgId],
    enabled: Boolean(orgId),
    queryFn: async () =>
      (await api.get<{ permissions: string[]; decision: string; reason: string }>('/api/authorization/effective-permissions', {
        params: { organizationId: orgId },
      })).data,
  });
  return (
    <Card>
      <Descriptions column={1} bordered>
        <Descriptions.Item label={mn.users}>{me?.username}</Descriptions.Item>
        <Descriptions.Item label={mn.name}>{me?.lastName} {me?.firstName}</Descriptions.Item>
        <Descriptions.Item label="Email">{me?.email}</Descriptions.Item>
        <Descriptions.Item label={mn.memberships}>
          {(me?.organizations || []).map((org) => <Tag key={org.id}>{org.name} · {label(org.orgType)}</Tag>)}
        </Descriptions.Item>
        <Descriptions.Item label={mn.activeOrg}>
          <Select
            style={{ minWidth: 280 }}
            value={orgId}
            onChange={onOrg}
            options={(me?.organizations || []).map((org) => ({ value: org.id, label: org.name }))}
          />
        </Descriptions.Item>
        <Descriptions.Item label={mn.positions}>
          {(me?.positions || []).map((position) => (
            <div key={position.positionId}>{position.organizationName} / {position.positionName} / {label(position.riskLevel)}</div>
          ))}
        </Descriptions.Item>
        <Descriptions.Item label={mn.effective}>
          {(permissions.data?.permissions || []).map((permission) => <Tag key={permission}>{permission}</Tag>)}
          <div>{label(permissions.data?.decision)} {permissions.data?.reason}</div>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

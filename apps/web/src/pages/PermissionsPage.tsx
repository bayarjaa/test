import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Checkbox, Col, Row, Table, Tag, message } from 'antd';
import { useState } from 'react';
import { api, errorText } from '../api';
import { label, mn } from '../labels';

interface MatrixRow {
  organizationId: string;
  organizationName: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  riskLevel: string;
  duties: string[];
  effectivePermissions: string[];
}

export function PermissionsPage({ organizationId }: { organizationId?: string }) {
  const client = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () =>
      (await api.get<{ permissions: Array<{ name: string }>; duties: Array<{ name: string; permissions: string[] }> }>('/api/roles')).data,
  });
  const matrix = useQuery({
    queryKey: ['matrix'],
    queryFn: async () => (await api.get<MatrixRow[]>('/api/permission-matrix')).data,
  });
  const [selected, setSelected] = useState<MatrixRow>();
  const toggle = useMutation({
    mutationFn: async ({ roleName, assigned }: { roleName: string; assigned: boolean }) => {
      if (!selected) return;
      if (assigned) {
        await api.delete(`/api/positions/${selected.positionId}/duties/${encodeURIComponent(roleName)}`, {
          params: { organizationId: selected.organizationId },
        });
      } else {
        await api.post(`/api/positions/${selected.positionId}/duties`, { organizationId: selected.organizationId, roleName });
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['matrix'] });
      const rows = (await api.get<MatrixRow[]>('/api/permission-matrix')).data;
      setSelected(rows.find((row) => row.positionId === selected?.positionId));
    },
    onError: (error) => message.error(errorText(error)),
  });
  const assigned = new Set(selected?.duties || []);
  const visible = (matrix.data || []).filter((row) => !organizationId || row.organizationId === organizationId);

  return (
    <Row gutter={16}>
      <Col span={10}>
        <Card title={mn.permissions}>
          {(roles.data?.permissions || []).map((permission) => <Tag key={permission.name}>{permission.name}</Tag>)}
        </Card>
        <Card title={mn.duties} style={{ marginTop: 16 }}>
          {(roles.data?.duties || []).map((duty) => (
            <div key={duty.name} style={{ marginBottom: 8 }}>
              <strong>{duty.name}</strong>
              <div>{duty.permissions.map((permission) => <Tag key={permission}>{permission}</Tag>)}</div>
            </div>
          ))}
        </Card>
      </Col>
      <Col span={14}>
        <Table
          rowKey="positionId"
          dataSource={visible}
          loading={matrix.isLoading}
          onRow={(row) => ({ onClick: () => setSelected(row) })}
          columns={[
            { title: mn.organizations, dataIndex: 'organizationName' },
            { title: mn.department, dataIndex: 'departmentName' },
            { title: mn.position, dataIndex: 'positionName' },
            { title: mn.risk, dataIndex: 'riskLevel', render: label },
            { title: mn.duties, dataIndex: 'duties', render: (duties: string[]) => duties.join(', ') },
            { title: mn.effective, dataIndex: 'effectivePermissions', render: (items: string[]) => items.join(', ') },
          ]}
        />
        {selected && (
          <Card title={selected.positionName} style={{ marginTop: 16 }}>
            {(roles.data?.duties || []).map((duty) => (
              <div key={duty.name}>
                <Checkbox checked={assigned.has(duty.name)} onChange={() => toggle.mutate({ roleName: duty.name, assigned: assigned.has(duty.name) })}>
                  {duty.name}
                </Checkbox>
              </div>
            ))}
          </Card>
        )}
      </Col>
    </Row>
  );
}

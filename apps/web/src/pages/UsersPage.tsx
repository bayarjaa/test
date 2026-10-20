import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Drawer, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { useState } from 'react';
import { api, errorText } from '../api';
import { label, mn } from '../labels';

interface KcUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}
interface PositionRow {
  organizationId: string;
  organizationName: string;
  positionId: string;
  positionName: string;
  riskLevel?: string;
  duties: string[];
  effectivePermissions: string[];
}
interface PositionOption {
  id: string;
  positionName: string;
  riskLevel: string;
}

export function UsersPage({ organizationId }: { organizationId?: string }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const users = useQuery({
    queryKey: ['users', term],
    queryFn: async () => (await api.get<KcUser[]>('/api/users', { params: { search: term } })).data,
  });
  const [current, setCurrent] = useState<KcUser>();
  const positions = useQuery({
    queryKey: ['user-positions', current?.id],
    enabled: Boolean(current),
    queryFn: async () => (await api.get<PositionRow[]>(`/api/users/${current?.id}/positions`)).data,
  });
  const options = useQuery({
    queryKey: ['position-options', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => (await api.get<PositionOption[]>(`/api/organizations/${organizationId}/positions`)).data,
  });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const assign = useMutation({
    mutationFn: (values: { positionGroupId: string; expiresAt?: { toISOString: () => string } }) =>
      api.post('/api/access-requests', {
        organizationId,
        positionGroupId: values.positionGroupId,
        targetKeycloakId: current?.id,
        expiresAt: values.expiresAt?.toISOString(),
      }),
    onSuccess: () => {
      message.success(mn.requests);
      setOpen(false);
    },
    onError: (error) => message.error(errorText(error)),
  });
  const revoke = useMutation({
    mutationFn: (row: PositionRow) =>
      api.delete(`/api/users/${current?.id}/positions/${row.positionId}`, { params: { organizationId: row.organizationId } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['user-positions', current?.id] });
    },
    onError: (error) => message.error(errorText(error)),
  });

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={mn.search} />
        <Button type="primary" onClick={() => setTerm(search)}>{mn.search}</Button>
      </Space>
      <Table
        rowKey="id"
        loading={users.isLoading}
        dataSource={users.data}
        onRow={(row) => ({ onClick: () => setCurrent(row) })}
        columns={[
          { title: mn.users, dataIndex: 'username' },
          { title: mn.name, render: (_, row) => `${row.lastName || ''} ${row.firstName || ''}` },
          { title: 'Email', dataIndex: 'email' },
        ]}
      />
      <Drawer title={current?.username} open={Boolean(current)} onClose={() => setCurrent(undefined)} width={560}>
        <Button type="primary" onClick={() => setOpen(true)} disabled={!organizationId}>{mn.assign}</Button>
        {(positions.data || []).map((row) => (
          <CardLike key={row.positionId} row={row} onRemove={() => revoke.mutate(row)} />
        ))}
      </Drawer>
      <Modal title={mn.assign} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(values) => assign.mutate(values)}>
          <Form.Item name="positionGroupId" label={mn.position} rules={[{ required: true }]}>
            <Select options={(options.data || []).map((position) => ({ value: position.id, label: `${position.positionName} (${label(position.riskLevel)})` }))} />
          </Form.Item>
          <Form.Item name="expiresAt" label={mn.expires}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function CardLike({ row, onRemove }: { row: PositionRow; onRemove: () => void }) {
  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div>{row.organizationName} / {row.positionName} / {label(row.riskLevel)}</div>
      <div>{row.duties.map((duty) => <Tag key={duty}>{duty}</Tag>)}</div>
      <div>{row.effectivePermissions.map((permission) => <Tag color="blue" key={permission}>{permission}</Tag>)}</div>
      <Button danger size="small" onClick={onRemove}>{mn.remove}</Button>
    </div>
  );
}

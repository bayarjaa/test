import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { useState } from 'react';
import { api, errorText } from '../api';
import { label, mn } from '../labels';

interface RequestRow {
  id: string;
  organizationId: string;
  positionGroupId: string;
  targetKeycloakId: string;
  riskLevel: string;
  status: string;
  expiresAt?: string | null;
  comment?: string | null;
}
interface UserOption { id: string; username?: string }
interface PositionOption { id: string; positionName: string; riskLevel: string }

export function AccessPage({ organizationId }: { organizationId?: string }) {
  const client = useQueryClient();
  const requests = useQuery({
    queryKey: ['requests', organizationId],
    queryFn: async () => (await api.get<RequestRow[]>('/api/access-requests', { params: { organizationId } })).data,
  });
  const users = useQuery({ queryKey: ['users', ''], queryFn: async () => (await api.get<UserOption[]>('/api/users')).data });
  const positions = useQuery({
    queryKey: ['position-options', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => (await api.get<PositionOption[]>(`/api/organizations/${organizationId}/positions`)).data,
  });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const refresh = () => client.invalidateQueries({ queryKey: ['requests', organizationId] });
  const create = useMutation({
    mutationFn: (values: { targetKeycloakId: string; positionGroupId: string; comment?: string }) =>
      api.post('/api/access-requests', { ...values, organizationId }),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
    onError: (error) => message.error(errorText(error)),
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => api.post(`/api/access-requests/${id}/${action}`, {}),
    onSuccess: refresh,
    onError: (error) => message.error(errorText(error)),
  });

  return (
    <>
      <Button type="primary" disabled={!organizationId} onClick={() => setOpen(true)} style={{ marginBottom: 16 }}>{mn.create}</Button>
      <Table
        rowKey="id"
        loading={requests.isLoading}
        dataSource={requests.data}
        columns={[
          { title: mn.targetUser, dataIndex: 'targetKeycloakId' },
          { title: mn.position, dataIndex: 'positionGroupId' },
          { title: mn.risk, dataIndex: 'riskLevel', render: label },
          { title: mn.status, dataIndex: 'status', render: (status: string) => <Tag>{label(status)}</Tag> },
          { title: mn.expires, dataIndex: 'expiresAt', render: (value?: string) => value ? new Date(value).toLocaleString() : '—' },
          {
            title: '',
            render: (_, row) => row.status === 'PENDING' ? (
              <Space>
                <Button size="small" type="primary" onClick={() => decide.mutate({ id: row.id, action: 'approve' })}>{mn.approve}</Button>
                <Button size="small" danger onClick={() => decide.mutate({ id: row.id, action: 'reject' })}>{mn.reject}</Button>
              </Space>
            ) : null,
          },
        ]}
      />
      <Modal title={mn.requests} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="targetKeycloakId" label={mn.targetUser} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={(users.data || []).map((user) => ({ value: user.id, label: user.username }))} />
          </Form.Item>
          <Form.Item name="positionGroupId" label={mn.position} rules={[{ required: true }]}>
            <Select options={(positions.data || []).map((position) => ({ value: position.id, label: `${position.positionName} (${label(position.riskLevel)})` }))} />
          </Form.Item>
          <Form.Item name="comment" label={mn.comment}><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

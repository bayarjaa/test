import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, InputNumber, Modal, Space, Table, Tag, message } from 'antd';
import { useState } from 'react';
import { api, errorText } from '../api';
import { label, mn } from '../labels';

interface Budget {
  id: string;
  title: string;
  fiscalYear: number;
  status: string;
  creatorKeycloakId: string;
  lines: Array<{ id: string; description: string; amount: string }>;
  history?: Array<{ id: string; fromStatus: string | null; toStatus: string; comment?: string; createdAt: string }>;
}

export function BudgetsPage({ organizationId }: { organizationId?: string }) {
  const client = useQueryClient();
  const budgets = useQuery({
    queryKey: ['budgets', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => (await api.get<Budget[]>('/api/budgets', { params: { organizationId } })).data,
  });
  const [open, setOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string>();
  const detail = useQuery({
    queryKey: ['budget', currentId],
    enabled: Boolean(currentId),
    queryFn: async () => (await api.get<Budget>(`/api/budgets/${currentId}`)).data,
  });
  const [form] = Form.useForm();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['budgets', organizationId] });
    await client.invalidateQueries({ queryKey: ['budget', currentId] });
  };
  const create = useMutation({
    mutationFn: (values: { title: string; fiscalYear: number; description: string; amount: number }) =>
      api.post('/api/budgets', {
        organizationId,
        title: values.title,
        fiscalYear: values.fiscalYear,
        lines: [{ description: values.description, amount: values.amount }],
      }),
    onSuccess: async () => {
      setOpen(false);
      form.resetFields();
      await refresh();
    },
    onError: (error) => message.error(errorText(error)),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/api/budgets/${id}/${action}`, {}),
    onSuccess: refresh,
    onError: (error) => message.error(errorText(error)),
  });
  const perms = useQuery({
    queryKey: ['effective', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () =>
      (await api.get<{ permissions: string[] }>('/api/authorization/effective-permissions', { params: { organizationId } })).data,
  });
  const can = (permission: string) => (perms.data?.permissions || []).includes(permission);
  const budget = detail.data;

  return (
    <>
      <Button type="primary" disabled={!organizationId} onClick={() => setOpen(true)} style={{ marginBottom: 16 }}>{mn.create}</Button>
      <Table
        rowKey="id"
        loading={budgets.isLoading}
        dataSource={budgets.data}
        onRow={(row) => ({ onClick: () => setCurrentId(row.id) })}
        columns={[
          { title: mn.name, dataIndex: 'title' },
          { title: mn.year, dataIndex: 'fiscalYear' },
          { title: mn.status, dataIndex: 'status', render: (status: string) => <Tag>{label(status)}</Tag> },
        ]}
      />
      <Drawer title={budget?.title} open={Boolean(currentId)} onClose={() => setCurrentId(undefined)} width={520}>
        {budget && (
          <>
            <Tag>{label(budget.status)}</Tag>
            {budget.lines.map((line) => (
              <div key={line.id}>{line.description}: {line.amount}</div>
            ))}
            <Space style={{ margin: '12px 0' }}>
              {budget.status === 'DRAFT' && can('budget:draft:submit') && <Button onClick={() => act.mutate({ id: budget.id, action: 'submit' })}>{mn.submit}</Button>}
              {budget.status === 'SUBMITTED' && can('budget:draft:review') && <Button onClick={() => act.mutate({ id: budget.id, action: 'review' })}>{mn.review}</Button>}
              {(budget.status === 'SUBMITTED' || budget.status === 'REVIEWED') && can('budget:draft:return') && (
                <Button onClick={() => act.mutate({ id: budget.id, action: 'return' })}>{mn.return}</Button>
              )}
              {budget.status === 'REVIEWED' && can('budget:draft:approve') && <Button type="primary" onClick={() => act.mutate({ id: budget.id, action: 'approve' })}>{mn.approve}</Button>}
            </Space>
            <h4>{mn.history}</h4>
            {(budget.history || []).map((item) => (
              <div key={item.id}>
                {item.fromStatus ? `${label(item.fromStatus)} → ` : ''}
                {label(item.toStatus)} {item.comment || ''}
              </div>
            ))}
          </>
        )}
      </Drawer>
      <Modal title={mn.budgets} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending}>
        <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)} initialValues={{ fiscalYear: 2026 }}>
          <Form.Item name="title" label={mn.name} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="fiscalYear" label={mn.year} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="description" label={mn.description} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="amount" label={mn.amount} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

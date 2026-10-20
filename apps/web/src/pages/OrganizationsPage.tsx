import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Table, message } from 'antd';
import { useState } from 'react';
import { api, errorText } from '../api';
import { label, mn } from '../labels';

interface Org {
  id: string;
  name: string;
  alias?: string;
  attributes?: Record<string, string[]>;
}

export function OrganizationsPage() {
  const client = useQueryClient();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: async () => (await api.get<Org[]>('/api/organizations')).data });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const save = useMutation({
    mutationFn: async (values: Record<string, string>) => api.post('/api/organizations', values),
    onSuccess: async () => {
      message.success(mn.save);
      setOpen(false);
      form.resetFields();
      await client.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (error) => message.error(errorText(error)),
  });
  return (
    <>
      <Button type="primary" onClick={() => setOpen(true)} style={{ marginBottom: 16 }}>
        {mn.create}
      </Button>
      <Table
        rowKey="id"
        loading={orgs.isLoading}
        dataSource={orgs.data}
        columns={[
          { title: mn.name, dataIndex: 'name' },
          { title: mn.code, render: (_, row) => row.attributes?.code?.[0] },
          { title: mn.type, render: (_, row) => label(row.attributes?.org_type?.[0]) },
          { title: mn.parent, render: (_, row) => row.attributes?.parent_organization_id?.[0] || '—' },
          { title: 'Alias', dataIndex: 'alias' },
        ]}
      />
      <Modal title={mn.organizations} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="name" label={mn.name} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="alias" label="Alias" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label={mn.code} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="orgType" label={mn.type} rules={[{ required: true }]}>
            <Select options={['CENTRAL_GOVERNMENT', 'GOVERNMENT', 'PRIVATE'].map((value) => ({ value, label: label(value) }))} />
          </Form.Item>
          <Form.Item name="domain" label={mn.domain} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="parentOrganizationId" label={mn.parent}>
            <Select allowClear options={(orgs.data || []).map((org) => ({ value: org.id, label: org.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

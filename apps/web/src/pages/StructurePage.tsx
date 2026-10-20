import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Checkbox, Form, Input, Modal, Select, Space, Tag, Tree, message } from 'antd';
import { useState } from 'react';
import { api, errorText } from '../api';
import { label, mn } from '../labels';

interface Position {
  id: string;
  name: string;
  positionName: string;
  positionCode?: string;
  riskLevel: string;
}
interface Department {
  id: string;
  name: string;
  departmentCode?: string;
  positions: Position[];
}
interface DutyView {
  duties: Array<{ name: string }>;
  effectivePermissions: string[];
}

export function StructurePage({ organizationId }: { organizationId?: string }) {
  const client = useQueryClient();
  const departments = useQuery({
    queryKey: ['departments', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => (await api.get<Department[]>(`/api/organizations/${organizationId}/departments`)).data,
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<{ duties: Array<{ name: string }> }>('/api/roles')).data,
  });
  const [selected, setSelected] = useState<string>();
  const duties = useQuery({
    queryKey: ['duties', organizationId, selected],
    enabled: Boolean(organizationId && selected),
    queryFn: async () =>
      (await api.get<DutyView>(`/api/positions/${selected}/duties`, { params: { organizationId } })).data,
  });
  const [deptOpen, setDeptOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [deptForm] = Form.useForm();
  const [posForm] = Form.useForm();

  const createDept = useMutation({
    mutationFn: (values: { name: string; departmentCode: string }) =>
      api.post(`/api/organizations/${organizationId}/departments`, values),
    onSuccess: async () => {
      setDeptOpen(false);
      await client.invalidateQueries({ queryKey: ['departments', organizationId] });
    },
    onError: (error) => message.error(errorText(error)),
  });
  const createPos = useMutation({
    mutationFn: (values: Record<string, string>) => api.post(`/api/organizations/${organizationId}/positions`, values),
    onSuccess: async () => {
      setPosOpen(false);
      await client.invalidateQueries({ queryKey: ['departments', organizationId] });
    },
    onError: (error) => message.error(errorText(error)),
  });
  const toggleDuty = useMutation({
    mutationFn: async ({ roleName, assigned }: { roleName: string; assigned: boolean }) => {
      if (assigned) {
        await api.delete(`/api/positions/${selected}/duties/${encodeURIComponent(roleName)}`, { params: { organizationId } });
      } else {
        await api.post(`/api/positions/${selected}/duties`, { organizationId, roleName });
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['duties', organizationId, selected] });
      await client.invalidateQueries({ queryKey: ['matrix'] });
    },
    onError: (error) => message.error(errorText(error)),
  });

  const tree = (departments.data || []).map((department) => ({
    key: department.id,
    title: `${department.name} (${department.departmentCode || ''})`,
    children: department.positions.map((position) => ({
      key: position.id,
      title: `${position.positionName} · ${label(position.riskLevel)}`,
      isLeaf: true,
    })),
  }));
  const assigned = new Set((duties.data?.duties || []).map((duty) => duty.name));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space>
        <Button type="primary" disabled={!organizationId} onClick={() => setDeptOpen(true)}>{mn.department}</Button>
        <Button disabled={!organizationId} onClick={() => setPosOpen(true)}>{mn.position}</Button>
      </Space>
      <Card>
        <Tree
          treeData={tree}
          onSelect={(keys, info) => {
            if (info.node.isLeaf) setSelected(String(keys[0]));
          }}
        />
      </Card>
      {selected && (
        <Card title={mn.duties}>
          {(roles.data?.duties || []).map((duty) => (
            <div key={duty.name}>
              <Checkbox
                checked={assigned.has(duty.name)}
                onChange={() => toggleDuty.mutate({ roleName: duty.name, assigned: assigned.has(duty.name) })}
              >
                {duty.name}
              </Checkbox>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            {(duties.data?.effectivePermissions || []).map((permission) => (
              <Tag key={permission}>{permission}</Tag>
            ))}
          </div>
        </Card>
      )}
      <Modal title={mn.department} open={deptOpen} onCancel={() => setDeptOpen(false)} onOk={() => deptForm.submit()}>
        <Form form={deptForm} layout="vertical" onFinish={(values) => createDept.mutate(values)}>
          <Form.Item name="name" label={mn.name} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="departmentCode" label={mn.code} rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal title={mn.position} open={posOpen} onCancel={() => setPosOpen(false)} onOk={() => posForm.submit()}>
        <Form form={posForm} layout="vertical" onFinish={(values) => createPos.mutate(values)}>
          <Form.Item name="parentGroupId" label={mn.department} rules={[{ required: true }]}>
            <Select options={(departments.data || []).map((department) => ({ value: department.id, label: department.name }))} />
          </Form.Item>
          <Form.Item name="name" label={mn.name} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="positionName" label={mn.position} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="positionCode" label={mn.code} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="riskLevel" label={mn.risk} rules={[{ required: true }]}>
            <Select options={[{ value: 'LOW', label: mn.low }, { value: 'HIGH', label: mn.high }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

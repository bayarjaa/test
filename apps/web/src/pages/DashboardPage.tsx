import { useQuery } from '@tanstack/react-query';
import { Card, Col, List, Row, Statistic } from 'antd';
import { api } from '../api';
import { label, mn } from '../labels';

interface Summary {
  organizations: number;
  users: number;
  positions: number;
  budgetDocuments: number;
  pendingApprovals: number;
  recent: Array<{ id: string; action: string; decision?: string; reason?: string; createdAt: string }>;
}

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get<Summary>('/api/dashboard')).data });
  const data = summary.data;
  const cards = [
    [mn.organizationsCount, data?.organizations],
    [mn.usersCount, data?.users],
    [mn.positionsCount, data?.positions],
    [mn.budgetsCount, data?.budgetDocuments],
    [mn.pending, data?.pendingApprovals],
  ] as const;
  return (
    <>
      <Row gutter={[16, 16]}>
        {cards.map(([title, value]) => (
          <Col span={8} key={title}>
            <Card>
              <Statistic title={title} value={value ?? 0} loading={summary.isLoading} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card title={mn.recent} style={{ marginTop: 16 }}>
        <List
          dataSource={data?.recent || []}
          renderItem={(item) => (
            <List.Item>
              {new Date(item.createdAt).toLocaleString()} — {item.action} — {label(item.decision)} {item.reason || ''}
            </List.Item>
          )}
        />
      </Card>
    </>
  );
}

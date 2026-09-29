import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfigProvider,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  LogoutOutlined,
  MoonFilled,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { HttpUtil, SizeFormatter } from '@/utils';
import { FormField } from '@/components/form/rhf';
import { setMessageInstance } from '@/utils/messageBus';
import { pauseAnimationsUntilLeave, useTheme } from '@/hooks/useTheme';

const basePath = window.X_UI_BASE_PATH || '';
const ONE_GB = 1024 * 1024 * 1024;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// The reseller API binds JSON bodies; HttpUtil defaults to form-encoding.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface ResellerMe {
  username: string;
  groupName: string;
  allowedInboundIds: number[];
  quotaBytes: number;
  usedBytes: number;
  remainingBytes: number;
}

interface ResellerInbound {
  id: number;
  remark: string;
  protocol: string;
  port: number;
}

interface ResellerClient {
  email: string;
  enable: boolean;
  totalGB: number;
  expiryTime: number;
  comment?: string;
  createdAt: number;
  traffic?: { up: number; down: number } | null;
}

interface ClientPageResponse {
  items: ResellerClient[];
  total: number;
  filtered: number;
}

interface CreateClientForm {
  inboundId?: number;
  email: string;
  totalGB: number;
  delayedStart: boolean;
  expiryDays: number;
  expiryDate: number;
  comment: string;
}

const emptyCreateForm: CreateClientForm = {
  inboundId: undefined,
  email: '',
  totalGB: 20,
  delayedStart: false,
  expiryDays: 30,
  expiryDate: 0,
  comment: '',
};

export default function ResellerAppPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, toggleTheme, toggleUltra, antdThemeConfig } = useTheme();
  const [messageApi, messageContextHolder] = message.useMessage();

  const [me, setMe] = useState<ResellerMe | null>(null);
  const [inbounds, setInbounds] = useState<ResellerInbound[]>([]);
  const [clients, setClients] = useState<ResellerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const methods = useForm<CreateClientForm>({ defaultValues: emptyCreateForm });
  const delayedStart = useWatch({ control: methods.control, name: 'delayedStart' });
  const expiryDate = useWatch({ control: methods.control, name: 'expiryDate' });

  useEffect(() => setMessageInstance(messageApi), [messageApi]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [meMsg, inboundsMsg, clientsMsg] = await Promise.all([
        HttpUtil.get<ResellerMe>('/reseller/api/me', undefined, { silent: true }),
        HttpUtil.get<ResellerInbound[]>('/reseller/api/inbounds', undefined, { silent: true }),
        HttpUtil.get<ClientPageResponse>(
          '/reseller/api/clients',
          { pageSize: 500 },
          { silent: true },
        ),
      ]);
      if (meMsg.success && meMsg.obj) setMe(meMsg.obj);
      if (inboundsMsg.success && inboundsMsg.obj) setInbounds(inboundsMsg.obj);
      if (clientsMsg.success && clientsMsg.obj) setClients(clientsMsg.obj.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onLogout = useCallback(async () => {
    await HttpUtil.post('/reseller/logout', {}, { silent: true });
    window.location.href = basePath + 'reseller/login';
  }, []);

  const cycleTheme = useCallback(() => {
    pauseAnimationsUntilLeave('reseller-theme-cycle');
    if (!isDark) {
      toggleTheme();
      if (isUltra) toggleUltra();
    } else if (!isUltra) {
      toggleUltra();
    } else {
      toggleUltra();
      toggleTheme();
    }
  }, [isDark, isUltra, toggleTheme, toggleUltra]);

  const openCreate = useCallback(() => {
    methods.reset({
      ...emptyCreateForm,
      inboundId: inbounds[0]?.id,
    });
    setCreateOpen(true);
  }, [inbounds, methods]);

  const onCreate = useCallback(
    async (values: CreateClientForm) => {
      if (!values.inboundId) {
        messageApi.warning(t('pages.reseller.pickInbound'));
        return;
      }
      if (!(values.totalGB > 0)) {
        messageApi.warning(t('pages.clients.totalGB'));
        return;
      }
      let expiryTime = 0;
      if (values.delayedStart) {
        expiryTime = values.expiryDays > 0 ? -values.expiryDays * ONE_DAY_MS : 0;
      } else if (values.expiryDate > 0) {
        expiryTime = values.expiryDate;
      }
      setCreating(true);
      try {
        const msg = await HttpUtil.post(
          '/reseller/api/clients',
          {
            inboundId: values.inboundId,
            client: {
              email: values.email.trim(),
              totalGB: Math.round(values.totalGB * ONE_GB),
              expiryTime,
              comment: values.comment,
              enable: true,
            },
          },
          { headers: JSON_HEADERS },
        );
        if (msg.success) {
          setCreateOpen(false);
          await refresh();
        }
      } finally {
        setCreating(false);
      }
    },
    [messageApi, refresh, t],
  );

  const onToggleEnable = useCallback(
    async (email: string, enable: boolean) => {
      const msg = await HttpUtil.post(`/reseller/api/clients/${encodeURIComponent(email)}/${enable ? 'enable' : 'disable'}`, {});
      if (msg.success) await refresh();
    },
    [refresh],
  );

  const onResetTraffic = useCallback(
    async (email: string) => {
      const msg = await HttpUtil.post(
        `/reseller/api/clients/${encodeURIComponent(email)}/resetTraffic`,
        {},
      );
      if (msg.success) await refresh();
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (email: string) => {
      const msg = await HttpUtil.delete(`/reseller/api/clients/${encodeURIComponent(email)}`);
      if (msg.success) await refresh();
    },
    [refresh],
  );

  const quotaPercent = useMemo(() => {
    if (!me || me.quotaBytes <= 0) return 0;
    return Math.min(100, Math.round((me.usedBytes / me.quotaBytes) * 100));
  }, [me]);

  const columns: ColumnsType<ResellerClient> = useMemo(
    () => [
      { title: t('pages.clients.email'), dataIndex: 'email', key: 'email', ellipsis: true },
      {
        title: t('pages.clients.enable'),
        dataIndex: 'enable',
        key: 'enable',
        width: 90,
        render: (enable: boolean, row) => (
          <Switch checked={enable} onChange={(v) => onToggleEnable(row.email, v)} />
        ),
      },
      {
        title: t('pages.clients.totalGB'),
        dataIndex: 'totalGB',
        key: 'totalGB',
        render: (v: number) => (v > 0 ? SizeFormatter.sizeFormat(v) : '∞'),
      },
      {
        title: t('pages.reseller.used'),
        key: 'used',
        render: (_: unknown, row) =>
          SizeFormatter.sizeFormat((row.traffic?.up || 0) + (row.traffic?.down || 0)),
      },
      {
        title: t('pages.clients.expiryTime'),
        dataIndex: 'expiryTime',
        key: 'expiryTime',
        render: (v: number) => {
          if (v < 0) {
            return `${t('pages.clients.delayedStart')}: ${Math.round(v / -ONE_DAY_MS)}d`;
          }
          return v > 0 ? (
            new Date(v).toLocaleDateString()
          ) : (
            <Tag>{t('pages.reseller.neverExpire')}</Tag>
          );
        },
      },
      {
        title: t('pages.clients.comment'),
        dataIndex: 'comment',
        key: 'comment',
        ellipsis: true,
      },
      {
        title: t('pages.clients.actions'),
        key: 'actions',
        width: 120,
        render: (_: unknown, row) => (
          <Space size={4}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              title={t('pages.reseller.resetTraffic')}
              onClick={() => onResetTraffic(row.email)}
            />
            <Popconfirm
              title={t('pages.reseller.deleteConfirm')}
              onConfirm={() => onDelete(row.email)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [onDelete, onResetTraffic, onToggleEnable, t],
  );

  const pageClass = ['login-app', isDark ? 'is-dark' : '', isUltra ? 'is-ultra' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      <Layout className={pageClass} style={{ minHeight: '100vh' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <Space direction="vertical" size={2}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {me?.username || t('pages.reseller.title')}
            </Typography.Title>
            <Space size={8} style={{ width: 260 }}>
              <Progress percent={quotaPercent} size="small" style={{ width: 180 }} />
              <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                {me ? `${SizeFormatter.sizeFormat(me.usedBytes)} / ${SizeFormatter.sizeFormat(me.quotaBytes)}` : ''}
              </Typography.Text>
            </Space>
          </Space>
          <Space>
            <Button
              shape="circle"
              icon={!isDark ? <SunOutlined /> : !isUltra ? <MoonOutlined /> : <MoonFilled />}
              onClick={cycleTheme}
              id="reseller-theme-cycle"
            />
            <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
              {t('pages.clients.addClient')}
            </Button>
            <Button icon={<LogoutOutlined />} onClick={onLogout}>
              {t('logout')}
            </Button>
          </Space>
        </div>

        <Layout.Content style={{ padding: '0 24px 24px' }}>
          <Table
            rowKey="email"
            loading={loading}
            columns={columns}
            dataSource={clients}
            pagination={{ pageSize: 20 }}
          />
        </Layout.Content>
      </Layout>

      <Modal
        open={createOpen}
        title={t('pages.clients.addClient')}
        onCancel={() => setCreateOpen(false)}
        onOk={methods.handleSubmit(onCreate)}
        confirmLoading={creating}
        destroyOnHidden
      >
        <FormProvider {...methods}>
          <Form layout="vertical">
            <FormField
              name="inboundId"
              label={t('pages.reseller.inbound')}
              rules={{ required: true }}
            >
              <Select
                options={inbounds.map((ib) => ({
                  value: ib.id,
                  label: `${ib.remark} (${ib.protocol}:${ib.port})`,
                }))}
                placeholder={t('pages.reseller.pickInbound')}
              />
            </FormField>
            <FormField name="email" label={t('pages.clients.email')} rules={{ required: true }}>
              <Input autoFocus />
            </FormField>
            <FormField
              name="totalGB"
              label={t('pages.clients.totalGB')}
              tooltip={t('pages.clients.totalGBDesc')}
              transform={{ output: (v) => Number(v) || 0 }}
            >
              <InputNumber min={0.1} step={1} style={{ width: '100%' }} />
            </FormField>
            <Form.Item label={t('pages.clients.delayedStart')}>
              <Switch
                checked={delayedStart}
                onChange={(v) => {
                  methods.setValue('delayedStart', v);
                  methods.setValue('expiryDate', 0);
                }}
              />
            </Form.Item>
            {delayedStart ? (
              <FormField
                name="expiryDays"
                label={t('pages.clients.expireDays')}
                transform={{ output: (v) => Number(v) || 0 }}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </FormField>
            ) : (
              <Form.Item label={t('pages.clients.expiryTime')}>
                <DatePicker
                  style={{ width: '100%' }}
                  value={expiryDate > 0 ? dayjs(expiryDate) : null}
                  disabledDate={(d) => d.endOf('day').valueOf() < Date.now()}
                  onChange={(next) =>
                    methods.setValue('expiryDate', next ? next.endOf('day').valueOf() : 0)
                  }
                />
              </Form.Item>
            )}
            <FormField name="comment" label={t('pages.clients.comment')}>
              <Input maxLength={200} />
            </FormField>
          </Form>
        </FormProvider>
      </Modal>
    </ConfigProvider>
  );
}

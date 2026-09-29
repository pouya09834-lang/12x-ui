import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Result,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import { useTheme } from '@/hooks/useTheme';
import { useInboundOptions } from '@/api/queries/useInboundOptions';
import AppSidebar from '@/layouts/AppSidebar';
import { HttpUtil } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } } as const;

interface ResellerRecord {
  id: number;
  username: string;
  groupName: string;
  allowedInboundIds: number[] | null;
  quotaBytes: number;
  usedBytes: number;
  trafficRatio?: number;
  enabled: boolean;
  createdAt: number;
}

interface CreateResponse {
  reseller: ResellerRecord;
  apiKey: string;
}

interface FormValues {
  username?: string;
  password?: string;
  groupName?: string;
  allowedInboundIds: number[];
  quotaGB: number;
  trafficRatio: number;
}

const GB = 1024 * 1024 * 1024;
const LIST_KEY = ['resellers', 'list'] as const;

const TEXT = {
  en: {
    title: 'Resellers',
    add: 'Add reseller',
    refresh: 'Refresh',
    username: 'Username',
    password: 'Password',
    passwordKeep: 'New password (leave empty to keep)',
    group: 'Client group',
    inbounds: 'Allowed inbounds',
    quota: 'Quota (GB)',
    ratio: 'Traffic ratio',
    ratioHint:
      'Every client this reseller creates gets this usage multiplier (2 = counts double, 0.5 = counts half). Applies to new clients only.',
    used: 'Used',
    enabled: 'Enabled',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    newKey: 'New API key',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    required: 'Required',
    createTitle: 'Add reseller',
    editTitle: 'Edit reseller',
    deleteTitle: 'Delete this reseller?',
    deleteBody: 'The account and its API key will be removed. Its clients are not deleted.',
    regenTitle: 'Generate a new API key?',
    regenBody: 'The old key stops working immediately.',
    keyTitle: 'API key',
    keyWarn: 'This key is shown only once. Copy it now.',
    copy: 'Copy',
    copied: 'Copied',
    loginUrl: 'Reseller login page',
    loginCopy: 'Copy login link',
    loadFailed: 'Failed to load resellers',
    empty: 'No resellers yet',
    groupHint: 'Must be unique. Cannot be changed later.',
  },
  fa: {
    title: 'ریسلرها',
    add: 'افزودن ریسلر',
    refresh: 'تازه‌سازی',
    username: 'نام کاربری',
    password: 'رمز عبور',
    passwordKeep: 'رمز جدید (خالی = بدون تغییر)',
    group: 'گروه کلاینت‌ها',
    inbounds: 'اینباندهای مجاز',
    quota: 'سهمیه (گیگابایت)',
    ratio: 'ضریب مصرف',
    ratioHint:
      'هر کلاینتی که این ریسلر بسازد با این ضریب ثبت می‌شود (۲ = دو برابر حساب می‌شود، ۰.۵ = نصف). فقط روی کلاینت‌های جدید اعمال می‌شود.',
    used: 'مصرف‌شده',
    enabled: 'فعال',
    actions: 'عملیات',
    edit: 'ویرایش',
    delete: 'حذف',
    newKey: 'کلید API جدید',
    save: 'ذخیره',
    cancel: 'انصراف',
    close: 'بستن',
    required: 'الزامی',
    createTitle: 'افزودن ریسلر',
    editTitle: 'ویرایش ریسلر',
    deleteTitle: 'این ریسلر حذف شود؟',
    deleteBody: 'حساب و کلید API حذف می‌شود، ولی کلاینت‌های ساخته‌شده پاک نمی‌شوند.',
    regenTitle: 'کلید API جدید ساخته شود؟',
    regenBody: 'کلید قبلی بلافاصله از کار می‌افتد.',
    keyTitle: 'کلید API',
    keyWarn: 'این کلید فقط یک‌بار نمایش داده می‌شود. همین حالا کپی کن.',
    copy: 'کپی',
    copied: 'کپی شد',
    loginUrl: 'صفحه ورود ریسلر',
    loginCopy: 'کپی لینک ورود',
    loadFailed: 'بارگذاری ریسلرها ناموفق بود',
    empty: 'هنوز ریسلری نیست',
    groupHint: 'باید یکتا باشد و بعداً قابل تغییر نیست.',
  },
};

function formatBytes(n: number): string {
  if (!n) return '0';
  const gb = n / GB;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 2)} GB`;
  return `${(n / (1024 * 1024)).toFixed(0)} MB`;
}

function loginLink(): string {
  const base = (window.X_UI_BASE_PATH || '/').replace(/\/+$/, '');
  return `${window.location.origin}${base}/reseller/login`;
}

async function fetchResellers(): Promise<ResellerRecord[]> {
  const msg = await HttpUtil.get<ResellerRecord[]>('/panel/api/resellers/list', undefined, {
    silent: true,
  });
  if (!msg?.success) throw new Error(msg?.msg || 'Failed to fetch resellers');
  return Array.isArray(msg.obj) ? msg.obj : [];
}

export default function ResellersPage() {
  const { i18n } = useTranslation();
  const tx = i18n.language?.startsWith('fa') ? TEXT.fa : TEXT.en;
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const [modal, modalContextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);

  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: LIST_KEY, queryFn: fetchResellers });
  const { data: inboundOptions = [] } = useInboundOptions();
  const resellers = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const [form] = Form.useForm<FormValues>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ResellerRecord | null>(null);
  const [keyModal, setKeyModal] = useState<{ username: string; apiKey: string } | null>(null);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['resellers'] }),
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: (v: FormValues) =>
      HttpUtil.post<CreateResponse>(
        '/panel/api/resellers/create',
        {
          username: v.username,
          password: v.password,
          groupName: v.groupName,
          allowedInboundIds: v.allowedInboundIds,
          quotaBytes: Math.round(v.quotaGB * GB),
          trafficRatio: v.trafficRatio || 1,
        },
        JSON_HEADERS,
      ),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      HttpUtil.post(`/panel/api/resellers/update/${id}`, body, JSON_HEADERS),
  });
  const regenMutation = useMutation({
    mutationFn: (id: number) =>
      HttpUtil.post<{ apiKey: string }>(`/panel/api/resellers/regenerateApiKey/${id}`),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => HttpUtil.post(`/panel/api/resellers/delete/${id}`),
  });

  const openCreate = useCallback(() => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ allowedInboundIds: [], quotaGB: 100, trafficRatio: 1 });
    setFormOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (r: ResellerRecord) => {
      setEditing(r);
      form.resetFields();
      form.setFieldsValue({
        allowedInboundIds: r.allowedInboundIds ?? [],
        quotaGB: Number((r.quotaBytes / GB).toFixed(2)),
        trafficRatio: r.trafficRatio && r.trafficRatio > 0 ? r.trafficRatio : 1,
      });
      setFormOpen(true);
    },
    [form],
  );

  const onSubmit = useCallback(async () => {
    const v = await form.validateFields();
    if (editing) {
      const body: Record<string, unknown> = {
        allowedInboundIds: v.allowedInboundIds,
        quotaBytes: Math.round(v.quotaGB * GB),
        trafficRatio: v.trafficRatio || 1,
      };
      if (v.password) body.password = v.password;
      const msg = await updateMutation.mutateAsync({ id: editing.id, body });
      if (msg?.success) {
        setFormOpen(false);
        await invalidate();
      }
      return;
    }
    const msg = await createMutation.mutateAsync(v);
    if (msg?.success && msg.obj) {
      setFormOpen(false);
      setKeyModal({ username: msg.obj.reseller.username, apiKey: msg.obj.apiKey });
      await invalidate();
    }
  }, [form, editing, updateMutation, createMutation, invalidate]);

  const onToggle = useCallback(
    async (r: ResellerRecord, next: boolean) => {
      const msg = await updateMutation.mutateAsync({ id: r.id, body: { enabled: next } });
      if (msg?.success) await invalidate();
    },
    [updateMutation, invalidate],
  );

  const onRegen = useCallback(
    (r: ResellerRecord) => {
      modal.confirm({
        title: tx.regenTitle,
        content: tx.regenBody,
        okText: tx.newKey,
        cancelText: tx.cancel,
        onOk: async () => {
          const msg = await regenMutation.mutateAsync(r.id);
          if (msg?.success && msg.obj) {
            setKeyModal({ username: r.username, apiKey: msg.obj.apiKey });
          }
        },
      });
    },
    [modal, tx, regenMutation],
  );

  const onDelete = useCallback(
    (r: ResellerRecord) => {
      modal.confirm({
        title: tx.deleteTitle,
        content: tx.deleteBody,
        okText: tx.delete,
        okType: 'danger',
        cancelText: tx.cancel,
        onOk: async () => {
          const msg = await deleteMutation.mutateAsync(r.id);
          if (msg?.success) await invalidate();
        },
      });
    },
    [modal, tx, deleteMutation, invalidate],
  );

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        messageApi.success(tx.copied);
      } catch {
        messageApi.error('Copy failed');
      }
    },
    [messageApi, tx],
  );

  const inboundLabel = useCallback(
    (id: number) => {
      const ib = inboundOptions.find((o) => o.id === id);
      if (!ib) return `#${id}`;
      return `${ib.remark || ib.tag || `#${id}`} (${ib.protocol ?? ''}:${ib.port ?? ''})`;
    },
    [inboundOptions],
  );

  const columns: ColumnsType<ResellerRecord> = [
    { title: tx.username, dataIndex: 'username', key: 'username' },
    { title: tx.group, dataIndex: 'groupName', key: 'groupName' },
    {
      title: tx.inbounds,
      key: 'inbounds',
      render: (_, r) => (
        <Space size={[4, 4]} wrap>
          {(r.allowedInboundIds ?? []).map((id) => (
            <Tag key={id}>{inboundLabel(id)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: `${tx.used} / ${tx.quota}`,
      key: 'quota',
      render: (_, r) => `${formatBytes(r.usedBytes)} / ${formatBytes(r.quotaBytes)}`,
    },
    {
      title: tx.ratio,
      key: 'ratio',
      render: (_, r) => `×${r.trafficRatio && r.trafficRatio > 0 ? r.trafficRatio : 1}`,
    },
    {
      title: tx.enabled,
      key: 'enabled',
      render: (_, r) => <Switch checked={r.enabled} onChange={(v) => onToggle(r, v)} />,
    },
    {
      title: tx.actions,
      key: 'actions',
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} title={tx.edit} />
          <Button size="small" icon={<KeyOutlined />} onClick={() => onRegen(r)} title={tx.newKey} />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete(r)}
            title={tx.delete}
          />
        </Space>
      ),
    },
  ];

  const pageClass = ['resellers-page', isDark ? 'is-dark' : '', isUltra ? 'is-ultra' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      {modalContextHolder}
      <Layout className={pageClass}>
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content id="content-layout" className="content-area">
            {listQuery.isError ? (
              <Result
                status="error"
                title={tx.loadFailed}
                subTitle={(listQuery.error as Error).message}
                extra={
                  <Button type="primary" onClick={() => listQuery.refetch()}>
                    {tx.refresh}
                  </Button>
                }
              />
            ) : (
              <Card
                size="small"
                title={tx.title}
                extra={
                  <Space wrap>
                    <Button icon={<CopyOutlined />} onClick={() => copy(loginLink())}>
                      {tx.loginCopy}
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      loading={listQuery.isFetching}
                      onClick={() => listQuery.refetch()}
                    >
                      {tx.refresh}
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                      {tx.add}
                    </Button>
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  {tx.loginUrl}: <Typography.Text code>{loginLink()}</Typography.Text>
                </Typography.Paragraph>
                <Table<ResellerRecord>
                  rowKey="id"
                  size="small"
                  columns={columns}
                  dataSource={resellers}
                  loading={listQuery.isLoading}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: tx.empty }}
                />
              </Card>
            )}
          </Layout.Content>
        </Layout>

        <Modal
          open={formOpen}
          title={editing ? `${tx.editTitle}: ${editing.username}` : tx.createTitle}
          okText={tx.save}
          cancelText={tx.cancel}
          confirmLoading={createMutation.isPending || updateMutation.isPending}
          onOk={onSubmit}
          onCancel={() => setFormOpen(false)}
          destroyOnHidden
        >
          <Form form={form} layout="vertical">
            {!editing && (
              <>
                <Form.Item
                  name="username"
                  label={tx.username}
                  rules={[{ required: true, message: tx.required }]}
                >
                  <Input autoComplete="off" />
                </Form.Item>
                <Form.Item
                  name="groupName"
                  label={tx.group}
                  extra={tx.groupHint}
                  rules={[{ required: true, message: tx.required }]}
                >
                  <Input
                    placeholder="reseller:ali"
                    dir="ltr"
                    onFocus={() => {
                      const u = form.getFieldValue('username');
                      if (u && !form.getFieldValue('groupName')) {
                        form.setFieldValue('groupName', `reseller:${u}`);
                      }
                    }}
                  />
                </Form.Item>
              </>
            )}
            <Form.Item
              name="password"
              label={editing ? tx.passwordKeep : tx.password}
              rules={editing ? [] : [{ required: true, message: tx.required }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="allowedInboundIds" label={tx.inbounds}>
              <Select
                mode="multiple"
                options={inboundOptions.map((o) => ({
                  value: o.id,
                  label: inboundLabel(o.id),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="quotaGB"
              label={tx.quota}
              rules={[{ required: true, message: tx.required }]}
            >
              <InputNumber min={0} step={10} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="trafficRatio"
              label={tx.ratio}
              extra={tx.ratioHint}
              rules={[{ required: true, message: tx.required }]}
            >
              <InputNumber min={0.01} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          open={keyModal !== null}
          title={`${tx.keyTitle}: ${keyModal?.username ?? ''}`}
          onCancel={() => setKeyModal(null)}
          footer={
            <Button type="primary" onClick={() => setKeyModal(null)}>
              {tx.close}
            </Button>
          }
        >
          <Typography.Paragraph type="warning">{tx.keyWarn}</Typography.Paragraph>
          <Input.TextArea value={keyModal?.apiKey ?? ''} readOnly autoSize dir="ltr" />
          <Button
            style={{ marginTop: 12 }}
            icon={<CopyOutlined />}
            onClick={() => copy(keyModal?.apiKey ?? '')}
          >
            {tx.copy}
          </Button>
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}

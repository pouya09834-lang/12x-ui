import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  MoonFilled,
  MoonOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RetweetOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

import { ClipboardManager, HttpUtil, SizeFormatter } from '@/utils';
import { QrPanel } from '@/pages/inbounds/qr';
import { setMessageInstance } from '@/utils/messageBus';
import { pauseAnimationsUntilLeave, useTheme } from '@/hooks/useTheme';

const basePath = window.X_UI_BASE_PATH || '';
const ONE_GB = 1024 * 1024 * 1024;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 10_000;
// The reseller API binds JSON bodies; HttpUtil defaults to form-encoding.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const TEXT = {
  en: {
    clients: 'Clients',
    online: 'Online',
    ended: 'Ended',
    depleting: 'Depleting',
    disabled: 'Disabled',
    active: 'Active',
    search: 'Search email or comment…',
    filter: 'Filter',
    allClients: 'All clients',
    sort: 'Sort',
    oldest: 'Oldest first',
    newest: 'Newest first',
    emailAZ: 'Email A→Z',
    mostTraffic: 'Most traffic',
    recentOnline: 'Recently online',
    expSoon: 'Expiring soonest',
    refresh: 'Refresh',
    add: 'Add Client',
    logout: 'Log Out',
    actions: 'Actions',
    enabled: 'Enabled',
    client: 'Client',
    traffic: 'Traffic',
    expiry: 'Expiry',
    lastOnline: 'Last online',
    never: 'Never',
    offline: 'Offline',
    onlineTag: 'Online',
    qr: 'QR code',
    info: 'Client information',
    reset: 'Reset traffic',
    resetConfirm: 'Reset traffic? This counts against your quota again (the full traffic limit).',
    edit: 'Edit client',
    remove: 'Delete',
    removeConfirm:
      'Delete this client? If it was created less than 10 minutes ago and never connected, its volume returns to your quota.',
    email: 'Email',
    inbound: 'Inbound',
    pickInbound: 'Choose one or more inbounds',
    limit: 'Traffic limit (GB)',
    limitEditHint: 'Can only be increased. The difference is charged to your quota.',
    delayed: 'Start After First Use',
    days: 'Duration (days)',
    expiryDate: 'Expiry',
    comment: 'Comment',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    used: 'Used',
    remaining: 'Remaining',
    created: 'Created',
    subLink: 'Subscription link',
    subJson: 'Subscription (JSON) link',
    configs: 'Config links',
    noLinks: 'No links available',
    copy: 'Copy',
    quota: 'Quota',
    required: 'Required',
    empty: 'No clients',
    loadFailed: 'Failed to load',
  },
  fa: {
    clients: 'کلاینت‌ها',
    online: 'آنلاین',
    ended: 'تمام‌شده',
    depleting: 'رو به اتمام',
    disabled: 'غیرفعال',
    active: 'فعال',
    search: 'جستجوی ایمیل یا کامنت…',
    filter: 'فیلتر',
    allClients: 'همه‌ی کلاینت‌ها',
    sort: 'مرتب‌سازی',
    oldest: 'قدیمی‌ترین',
    newest: 'جدیدترین',
    emailAZ: 'ایمیل الف→ی',
    mostTraffic: 'بیشترین مصرف',
    recentOnline: 'آخرین آنلاین',
    expSoon: 'نزدیک‌ترین انقضا',
    refresh: 'تازه‌سازی',
    add: 'افزودن کلاینت',
    logout: 'خروج',
    actions: 'عملیات',
    enabled: 'فعال',
    client: 'کلاینت',
    traffic: 'ترافیک',
    expiry: 'انقضا',
    lastOnline: 'آخرین آنلاین',
    never: 'هرگز',
    offline: 'آفلاین',
    onlineTag: 'آنلاین',
    qr: 'کد QR',
    info: 'اطلاعات کلاینت',
    reset: 'ریست ترافیک',
    resetConfirm: 'ترافیک ریست شود؟ این کار دوباره کل حجم کلاینت را از سهمیه‌ی شما کم می‌کند.',
    edit: 'ویرایش کلاینت',
    remove: 'حذف',
    removeConfirm:
      'این کلاینت حذف شود؟ اگر کمتر از ۱۰ دقیقه از ساختش گذشته و هیچ‌وقت وصل نشده باشد، حجمش به سهمیه‌ی شما برمی‌گردد.',
    email: 'ایمیل',
    inbound: 'اینباند',
    pickInbound: 'یک یا چند اینباند انتخاب کنید',
    limit: 'حجم (گیگابایت)',
    limitEditHint: 'فقط قابل افزایش است و تفاوتش از سهمیه‌ی شما کم می‌شود.',
    delayed: 'شروع بعد از اولین استفاده',
    days: 'مدت (روز)',
    expiryDate: 'تاریخ انقضا',
    comment: 'کامنت',
    save: 'ذخیره',
    cancel: 'انصراف',
    close: 'بستن',
    used: 'مصرف‌شده',
    remaining: 'باقی‌مانده',
    created: 'تاریخ ساخت',
    subLink: 'لینک ساب',
    subJson: 'لینک ساب (JSON)',
    configs: 'لینک کانفیگ‌ها',
    noLinks: 'لینکی موجود نیست',
    copy: 'کپی',
    quota: 'سهمیه',
    required: 'الزامی',
    empty: 'کلاینتی نیست',
    loadFailed: 'بارگذاری ناموفق بود',
  },
};

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
  subId?: string;
  enable: boolean;
  totalGB: number;
  expiryTime: number;
  comment?: string;
  inboundIds?: number[];
  createdAt: number;
  traffic?: { up: number; down: number; lastOnline?: number } | null;
}

interface Summary {
  total: number;
  active: number;
  onlineCount: number;
  depletedCount: number;
  expiringCount: number;
  deactiveCount: number;
  online: string[];
}

interface ClientPageResponse {
  items: ResellerClient[];
  total: number;
  filtered: number;
  page: number;
  pageSize: number;
  summary: Summary;
}

interface ClientLinks {
  subId: string;
  subUrl: string;
  subJsonUrl: string;
  links: string[];
}

interface AddValues {
  inboundIds: number[];
  email: string;
  totalGB: number;
  delayedStart: boolean;
  expiryDays: number;
  expiryDate: number;
  comment: string;
}

const emptySummary: Summary = {
  total: 0,
  active: 0,
  onlineCount: 0,
  depletedCount: 0,
  expiringCount: 0,
  deactiveCount: 0,
  online: [],
};

const PAGE_SIZE = 20;

function sortParams(key: string): { sort?: string; order?: string } {
  if (!key) return {};
  const [sort, order] = key.split('|');
  return { sort, order };
}

function expiryToForm(expiryTime: number): Pick<AddValues, 'delayedStart' | 'expiryDays' | 'expiryDate'> {
  if (expiryTime < 0) {
    return { delayedStart: true, expiryDays: Math.round(expiryTime / -ONE_DAY_MS), expiryDate: 0 };
  }
  return { delayedStart: false, expiryDays: 30, expiryDate: expiryTime > 0 ? expiryTime : 0 };
}

function expiryFromForm(v: Pick<AddValues, 'delayedStart' | 'expiryDays' | 'expiryDate'>): number {
  if (v.delayedStart) return v.expiryDays > 0 ? -v.expiryDays * ONE_DAY_MS : 0;
  return v.expiryDate > 0 ? v.expiryDate : 0;
}

export default function ResellerAppPage() {
  const { t, i18n } = useTranslation();
  const tx = i18n.language?.startsWith('fa') ? TEXT.fa : TEXT.en;
  const { isDark, isUltra, toggleTheme, toggleUltra, antdThemeConfig } = useTheme();
  const [messageApi, messageContextHolder] = message.useMessage();
  useEffect(() => setMessageInstance(messageApi), [messageApi]);

  const [me, setMe] = useState<ResellerMe | null>(null);
  const [inbounds, setInbounds] = useState<ResellerInbound[]>([]);
  const [data, setData] = useState<ClientPageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // Keep the latest query in a ref so the poll timer never uses stale values.
  const queryRef = useRef({ debouncedSearch, filter, sortKey, page });
  useEffect(() => {
    queryRef.current = { debouncedSearch, filter, sortKey, page };
  }, [debouncedSearch, filter, sortKey, page]);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const q = queryRef.current;
      const [meMsg, inboundsMsg, clientsMsg] = await Promise.all([
        HttpUtil.get<ResellerMe>('/reseller/api/me', undefined, { silent: true }),
        HttpUtil.get<ResellerInbound[]>('/reseller/api/inbounds', undefined, { silent: true }),
        HttpUtil.get<ClientPageResponse>(
          '/reseller/api/clients',
          {
            page: q.page,
            pageSize: PAGE_SIZE,
            search: q.debouncedSearch || undefined,
            filter: q.filter || undefined,
            ...sortParams(q.sortKey),
          },
          { silent: true },
        ),
      ]);
      if (meMsg.success && meMsg.obj) setMe(meMsg.obj);
      if (inboundsMsg.success && inboundsMsg.obj) setInbounds(inboundsMsg.obj);
      if (clientsMsg.success && clientsMsg.obj) setData(clientsMsg.obj);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load, debouncedSearch, filter, sortKey, page]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

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

  const summary = data?.summary ?? emptySummary;
  const onlineSet = useMemo(() => new Set(summary.online), [summary.online]);
  const inboundLabel = useCallback(
    (id: number) => {
      const ib = inbounds.find((x) => x.id === id);
      return ib ? `${ib.remark} (${ib.protocol}:${ib.port})` : `#${id}`;
    },
    [inbounds],
  );

  const quotaPercent = useMemo(() => {
    if (!me || me.quotaBytes <= 0) return 0;
    return Math.min(100, Math.round((me.usedBytes / me.quotaBytes) * 100));
  }, [me]);

  /* ---------------------------------------------------------- add / edit */

  const [addForm] = Form.useForm<AddValues>();
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const addDelayed = Form.useWatch('delayedStart', addForm);

  const openAdd = useCallback(() => {
    addForm.resetFields();
    addForm.setFieldsValue({
      inboundIds: inbounds.length === 1 ? [inbounds[0].id] : [],
      totalGB: 20,
      delayedStart: false,
      expiryDays: 30,
      expiryDate: 0,
      comment: '',
    });
    setAddOpen(true);
  }, [addForm, inbounds]);

  const submitAdd = useCallback(async () => {
    const v = await addForm.validateFields();
    if (!v.inboundIds || v.inboundIds.length === 0) {
      messageApi.warning(tx.pickInbound);
      return;
    }
    setSaving(true);
    try {
      const msg = await HttpUtil.post(
        '/reseller/api/clients',
        {
          inboundIds: v.inboundIds,
          client: {
            email: v.email.trim(),
            totalGB: Math.round(v.totalGB * ONE_GB),
            expiryTime: expiryFromForm(v),
            comment: v.comment ?? '',
            enable: true,
          },
        },
        { headers: JSON_HEADERS },
      );
      if (msg.success) {
        setAddOpen(false);
        await load(false);
      }
    } finally {
      setSaving(false);
    }
  }, [addForm, load, messageApi, tx.pickInbound]);

  const [editForm] = Form.useForm<AddValues>();
  const [editing, setEditing] = useState<ResellerClient | null>(null);
  const editDelayed = Form.useWatch('delayedStart', editForm);

  const openEdit = useCallback(
    (row: ResellerClient) => {
      setEditing(row);
      editForm.resetFields();
      editForm.setFieldsValue({
        email: row.email,
        inboundIds: (row.inboundIds ?? []).filter((id) => inbounds.some((ib) => ib.id === id)),
        totalGB: Number((row.totalGB / ONE_GB).toFixed(2)),
        comment: row.comment ?? '',
        ...expiryToForm(row.expiryTime),
      });
    },
    [editForm, inbounds],
  );

  const submitEdit = useCallback(async () => {
    if (!editing) return;
    const v = await editForm.validateFields();
    if (!v.inboundIds || v.inboundIds.length === 0) {
      messageApi.warning(tx.pickInbound);
      return;
    }
    setSaving(true);
    try {
      const msg = await HttpUtil.post(
        `/reseller/api/clients/${encodeURIComponent(editing.email)}/update`,
        {
          inboundIds: v.inboundIds,
          totalGB: Math.round(v.totalGB * ONE_GB),
          expiryTime: expiryFromForm(v),
          comment: v.comment ?? '',
        },
        { headers: JSON_HEADERS },
      );
      if (msg.success) {
        setEditing(null);
        await load(false);
      }
    } finally {
      setSaving(false);
    }
  }, [editForm, editing, load, messageApi, tx.pickInbound]);

  /* ------------------------------------------------------------- actions */

  const onToggleEnable = useCallback(
    async (email: string, enable: boolean) => {
      const msg = await HttpUtil.post(
        `/reseller/api/clients/${encodeURIComponent(email)}/${enable ? 'enable' : 'disable'}`,
        {},
      );
      if (msg.success) await load(false);
    },
    [load],
  );

  const onResetTraffic = useCallback(
    async (email: string) => {
      const msg = await HttpUtil.post(
        `/reseller/api/clients/${encodeURIComponent(email)}/resetTraffic`,
        {},
      );
      if (msg.success) await load(false);
    },
    [load],
  );

  const onDelete = useCallback(
    async (email: string) => {
      const msg = await HttpUtil.delete(`/reseller/api/clients/${encodeURIComponent(email)}`);
      if (msg.success) await load(false);
    },
    [load],
  );

  /* ----------------------------------------------------- info / QR dialog */

  const [dialog, setDialog] = useState<{ row: ResellerClient; mode: 'info' | 'qr' } | null>(null);
  const [links, setLinks] = useState<ClientLinks | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);

  const openDialog = useCallback(async (row: ResellerClient, mode: 'info' | 'qr') => {
    setDialog({ row, mode });
    setLinks(null);
    setLinksLoading(true);
    try {
      const msg = await HttpUtil.get<ClientLinks>(
        `/reseller/api/clients/${encodeURIComponent(row.email)}/links`,
        undefined,
        { silent: true },
      );
      if (msg.success && msg.obj) setLinks(msg.obj);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  const copyText = useCallback(
    async (text: string) => {
      const ok = await ClipboardManager.copyText(text);
      if (ok) messageApi.success(t('copied'));
    },
    [messageApi, t],
  );

  const allLinkEntries = useMemo(() => {
    const out: { key: string; label: string; value: string }[] = [];
    if (links?.subUrl) out.push({ key: 'sub', label: tx.subLink, value: links.subUrl });
    if (links?.subJsonUrl) out.push({ key: 'subjson', label: tx.subJson, value: links.subJsonUrl });
    (links?.links ?? []).forEach((l, i) => {
      const hash = l.includes('#') ? decodeURIComponent(l.slice(l.lastIndexOf('#') + 1)) : '';
      out.push({ key: `cfg${i}`, label: hash || `${tx.configs} ${i + 1}`, value: l });
    });
    return out;
  }, [links, tx]);

  /* --------------------------------------------------------------- table */

  const fmtExpiry = useCallback(
    (v: number) => {
      if (v < 0) return `${tx.delayed}: ${Math.round(v / -ONE_DAY_MS)}d`;
      return v > 0 ? new Date(v).toLocaleDateString() : <Tag>∞</Tag>;
    },
    [tx.delayed],
  );

  const columns: ColumnsType<ResellerClient> = useMemo(
    () => [
      {
        title: tx.actions,
        key: 'actions',
        width: 210,
        render: (_: unknown, row) => (
          <Space size={4}>
            <Button size="small" icon={<QrcodeOutlined />} title={tx.qr} onClick={() => openDialog(row, 'qr')} />
            <Button
              size="small"
              icon={<InfoCircleOutlined />}
              title={tx.info}
              onClick={() => openDialog(row, 'info')}
            />
            <Popconfirm title={tx.resetConfirm} onConfirm={() => onResetTraffic(row.email)}>
              <Button size="small" icon={<RetweetOutlined />} title={tx.reset} />
            </Popconfirm>
            <Button size="small" icon={<EditOutlined />} title={tx.edit} onClick={() => openEdit(row)} />
            <Popconfirm title={tx.removeConfirm} okType="danger" onConfirm={() => onDelete(row.email)}>
              <Button size="small" danger icon={<DeleteOutlined />} title={tx.remove} />
            </Popconfirm>
          </Space>
        ),
      },
      {
        title: tx.enabled,
        dataIndex: 'enable',
        key: 'enable',
        width: 80,
        render: (enable: boolean, row) => (
          <Switch checked={enable} onChange={(v) => onToggleEnable(row.email, v)} />
        ),
      },
      {
        title: tx.onlineTag,
        key: 'online',
        width: 90,
        render: (_: unknown, row) =>
          onlineSet.has(row.email) ? (
            <Tag color="green">{tx.onlineTag}</Tag>
          ) : (
            <Tag>{tx.offline}</Tag>
          ),
      },
      {
        title: tx.client,
        key: 'client',
        ellipsis: true,
        render: (_: unknown, row) => (
          <div>
            <div>{row.email}</div>
            {row.comment ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.comment}
              </Typography.Text>
            ) : null}
          </div>
        ),
      },
      {
        title: tx.traffic,
        key: 'traffic',
        width: 260,
        render: (_: unknown, row) => {
          const used = (row.traffic?.up || 0) + (row.traffic?.down || 0);
          const pct = row.totalGB > 0 ? Math.min(100, Math.round((used / row.totalGB) * 100)) : 0;
          return (
            <Space size={6} style={{ width: '100%' }}>
              <span style={{ whiteSpace: 'nowrap' }}>{SizeFormatter.sizeFormat(used)}</span>
              <Progress percent={pct} showInfo={false} size="small" style={{ width: 80, margin: 0 }} />
              <span style={{ whiteSpace: 'nowrap' }}>
                {row.totalGB > 0 ? SizeFormatter.sizeFormat(row.totalGB) : '∞'}
              </span>
            </Space>
          );
        },
      },
      {
        title: tx.expiry,
        dataIndex: 'expiryTime',
        key: 'expiryTime',
        width: 170,
        render: (v: number) => fmtExpiry(v),
      },
      {
        title: tx.lastOnline,
        key: 'lastOnline',
        width: 140,
        render: (_: unknown, row) =>
          row.traffic?.lastOnline ? new Date(row.traffic.lastOnline).toLocaleString() : '-',
      },
    ],
    [fmtExpiry, onDelete, onResetTraffic, onToggleEnable, onlineSet, openDialog, openEdit, tx],
  );

  const statCards: { key: string; label: string; value: number; filter: string; dot: string }[] = [
    { key: 'total', label: tx.clients, value: summary.total, filter: '', dot: '#8c8c8c' },
    { key: 'online', label: tx.online, value: summary.onlineCount, filter: 'online', dot: '#1677ff' },
    { key: 'ended', label: tx.ended, value: summary.depletedCount, filter: 'depleted', dot: '#ff4d4f' },
    { key: 'dep', label: tx.depleting, value: summary.expiringCount, filter: 'expiring', dot: '#faad14' },
    { key: 'dis', label: tx.disabled, value: summary.deactiveCount, filter: 'deactive', dot: '#bfbfbf' },
    { key: 'act', label: tx.active, value: summary.active, filter: 'active', dot: '#52c41a' },
  ];

  const pageClass = ['login-app', isDark ? 'is-dark' : '', isUltra ? 'is-ultra' : '']
    .filter(Boolean)
    .join(' ');

  const expiryFields = (delayed: boolean | undefined, form: typeof addForm) => (
    <>
      <Form.Item name="delayedStart" label={tx.delayed} valuePropName="checked">
        <Switch
          onChange={() => {
            form.setFieldValue('expiryDate', 0);
          }}
        />
      </Form.Item>
      {delayed ? (
        <Form.Item name="expiryDays" label={tx.days}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      ) : (
        <Form.Item
          name="expiryDate"
          label={tx.expiryDate}
          getValueProps={(val: number) => ({ value: val > 0 ? dayjs(val) : null })}
          normalize={(next: dayjs.Dayjs | null) => (next ? next.endOf('day').valueOf() : 0)}
        >
          <DatePicker
            style={{ width: '100%' }}
            disabledDate={(d) => d.endOf('day').valueOf() < Date.now()}
          />
        </Form.Item>
      )}
    </>
  );

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
            <Space size={8}>
              <Progress percent={quotaPercent} size="small" style={{ width: 180 }} />
              <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                {me
                  ? `${SizeFormatter.sizeFormat(me.usedBytes)} / ${SizeFormatter.sizeFormat(me.quotaBytes)}`
                  : ''}
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
            <Button icon={<LogoutOutlined />} onClick={onLogout}>
              {tx.logout}
            </Button>
          </Space>
        </div>

        <Layout.Content style={{ padding: '0 24px 24px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {statCards.map((c) => (
              <Card
                key={c.key}
                size="small"
                hoverable
                onClick={() => {
                  setFilter(c.filter);
                  setPage(1);
                }}
                style={{
                  cursor: 'pointer',
                  borderColor: filter === c.filter ? c.dot : undefined,
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.label}
                </Typography.Text>
                <div style={{ fontSize: 22, fontWeight: 600 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: c.dot,
                      marginInlineEnd: 8,
                    }}
                  />
                  {c.value}
                </div>
              </Card>
            ))}
          </div>

          <Card size="small">
            <Space wrap style={{ marginBottom: 12, width: '100%' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
                {tx.add}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => load(true)}>
                {tx.refresh}
              </Button>
              <Input.Search
                allowClear
                placeholder={tx.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 260 }}
              />
              <Select
                value={filter}
                onChange={(v) => {
                  setFilter(v);
                  setPage(1);
                }}
                style={{ width: 160 }}
                options={[
                  { value: '', label: tx.allClients },
                  { value: 'online', label: tx.online },
                  { value: 'depleted', label: tx.ended },
                  { value: 'expiring', label: tx.depleting },
                  { value: 'deactive', label: tx.disabled },
                  { value: 'active', label: tx.active },
                ]}
              />
              <Select
                value={sortKey}
                onChange={(v) => {
                  setSortKey(v);
                  setPage(1);
                }}
                style={{ width: 180 }}
                options={[
                  { value: '', label: tx.oldest },
                  { value: 'createdAt|descend', label: tx.newest },
                  { value: 'email|ascend', label: tx.emailAZ },
                  { value: 'traffic|descend', label: tx.mostTraffic },
                  { value: 'lastOnline|descend', label: tx.recentOnline },
                  { value: 'expiryTime|ascend', label: tx.expSoon },
                ]}
              />
            </Space>

            <Table<ResellerClient>
              rowKey="email"
              size="small"
              loading={loading && !data}
              columns={columns}
              dataSource={data?.items ?? []}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty description={tx.empty} /> }}
            />
            {(data?.filtered ?? 0) > PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <Pagination
                  current={page}
                  pageSize={PAGE_SIZE}
                  total={data?.filtered ?? 0}
                  showSizeChanger={false}
                  onChange={(p) => setPage(p)}
                />
              </div>
            )}
          </Card>
        </Layout.Content>
      </Layout>

      <Modal
        open={addOpen}
        title={tx.add}
        okText={tx.save}
        cancelText={tx.cancel}
        onCancel={() => setAddOpen(false)}
        onOk={submitAdd}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical">
          <Form.Item name="inboundIds" label={tx.inbound} rules={[{ required: true, message: tx.required }]}>
            <Select
              mode="multiple"
              allowClear
              placeholder={tx.pickInbound}
              options={inbounds.map((ib) => ({
                value: ib.id,
                label: `${ib.remark} (${ib.protocol}:${ib.port})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="email" label={tx.email} rules={[{ required: true, message: tx.required }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="totalGB" label={tx.limit} rules={[{ required: true, message: tx.required }]}>
            <InputNumber min={0.1} step={1} style={{ width: '100%' }} />
          </Form.Item>
          {expiryFields(addDelayed, addForm)}
          <Form.Item name="comment" label={tx.comment}>
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editing !== null}
        title={`${tx.edit}: ${editing?.email ?? ''}`}
        okText={tx.save}
        cancelText={tx.cancel}
        onCancel={() => setEditing(null)}
        onOk={submitEdit}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="email" label={tx.email}>
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="inboundIds"
            label={tx.inbound}
            rules={[{ required: true, message: tx.required }]}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={tx.pickInbound}
              options={inbounds.map((ib) => ({
                value: ib.id,
                label: `${ib.remark} (${ib.protocol}:${ib.port})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="totalGB"
            label={tx.limit}
            extra={tx.limitEditHint}
            rules={[{ required: true, message: tx.required }]}
          >
            <InputNumber
              min={editing ? Number((editing.totalGB / ONE_GB).toFixed(2)) : 0.1}
              step={1}
              style={{ width: '100%' }}
            />
          </Form.Item>
          {expiryFields(editDelayed, editForm)}
          <Form.Item name="comment" label={tx.comment}>
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={dialog !== null}
        title={dialog ? `${dialog.mode === 'qr' ? tx.qr : tx.info}: ${dialog.row.email}` : ''}
        onCancel={() => setDialog(null)}
        footer={<Button onClick={() => setDialog(null)}>{tx.close}</Button>}
        width={560}
        destroyOnHidden
      >
        {dialog && dialog.mode === 'info' && (
          <>
            {(() => {
              const row = dialog.row;
              const used = (row.traffic?.up || 0) + (row.traffic?.down || 0);
              return (
                <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
                  <Descriptions.Item label={tx.email}>{row.email}</Descriptions.Item>
                  <Descriptions.Item label={tx.inbound}>
                    {(row.inboundIds ?? []).map((id) => inboundLabel(id)).join(', ') || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label={tx.limit}>
                    {row.totalGB > 0 ? SizeFormatter.sizeFormat(row.totalGB) : '∞'}
                  </Descriptions.Item>
                  <Descriptions.Item label={tx.used}>{SizeFormatter.sizeFormat(used)}</Descriptions.Item>
                  <Descriptions.Item label={tx.remaining}>
                    {row.totalGB > 0 ? SizeFormatter.sizeFormat(Math.max(0, row.totalGB - used)) : '∞'}
                  </Descriptions.Item>
                  <Descriptions.Item label={tx.expiry}>{fmtExpiry(row.expiryTime)}</Descriptions.Item>
                  <Descriptions.Item label={tx.comment}>{row.comment || '-'}</Descriptions.Item>
                  <Descriptions.Item label={tx.created}>
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : '-'}
                  </Descriptions.Item>
                </Descriptions>
              );
            })()}
            {linksLoading ? null : allLinkEntries.length === 0 ? (
              <Empty description={tx.noLinks} />
            ) : (
              allLinkEntries.map((e) => (
                <div key={e.key} style={{ marginBottom: 10 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {e.label}
                  </Typography.Text>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input value={e.value} readOnly dir="ltr" />
                    <Button icon={<CopyOutlined />} title={tx.copy} onClick={() => copyText(e.value)} />
                  </Space.Compact>
                </div>
              ))
            )}
          </>
        )}
        {dialog && dialog.mode === 'qr' &&
          (linksLoading ? null : allLinkEntries.length === 0 ? (
            <Empty description={tx.noLinks} />
          ) : (
            <Tabs
              items={allLinkEntries.map((e) => ({
                key: e.key,
                label: e.label.length > 18 ? `${e.label.slice(0, 18)}…` : e.label,
                children: <QrPanel value={e.value} remark={e.label} size={280} />,
              }))}
            />
          ))}
      </Modal>
    </ConfigProvider>
  );
}

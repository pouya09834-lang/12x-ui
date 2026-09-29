import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Form, InputNumber, Modal, message } from 'antd';
import { FormProvider, useForm } from 'react-hook-form';

import { ClientBulkRatioFormSchema, type ClientBulkRatioFormValues } from '@/schemas/client';
import { FormField } from '@/components/form/rhf';

const EMPTY: ClientBulkRatioFormValues = { ratio: 1 };

interface ClientBulkRatioModalProps {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    ratio: number,
  ) => Promise<{ changed: number; skipped?: { email: string; reason: string }[] } | null>;
}

export default function ClientBulkRatioModal({
  open,
  count,
  onOpenChange,
  onSubmit,
}: ClientBulkRatioModalProps) {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);
  const methods = useForm<ClientBulkRatioFormValues>({ defaultValues: EMPTY });

  useEffect(() => {
    if (open) methods.reset(EMPTY);
  }, [open, methods]);

  async function handleOk() {
    const values = methods.getValues();
    const validated = ClientBulkRatioFormSchema.safeParse({
      ratio: Number(values.ratio) || 0,
    });
    if (!validated.success) {
      messageApi.warning(t(validated.error.issues[0]?.message ?? 'somethingWentWrong'));
      return;
    }
    const { ratio } = validated.data;
    setSubmitting(true);
    try {
      const result = await onSubmit(ratio);
      if (!result) return;
      const ok = result.changed ?? 0;
      const skipped = result.skipped?.length ?? 0;
      if (skipped === 0) {
        messageApi.success(t('pages.clients.toasts.bulkRatioChanged', { count: ok }));
      } else {
        const firstReason = result.skipped?.[0]?.reason ?? '';
        messageApi.warning(
          firstReason
            ? `${t('pages.clients.toasts.bulkRatioChangedMixed', { ok, skipped })} — ${firstReason}`
            : t('pages.clients.toasts.bulkRatioChangedMixed', { ok, skipped }),
        );
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {messageContextHolder}
      <Modal
        open={open}
        title={t('pages.clients.bulkRatioTitle', { count })}
        okText={t('apply')}
        cancelText={t('cancel')}
        confirmLoading={submitting}
        onOk={handleOk}
        onCancel={() => onOpenChange(false)}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t('pages.clients.bulkRatioHint')}
        />
        <FormProvider {...methods}>
          <Form layout="vertical">
            <FormField
              name="ratio"
              label={t('pages.clients.trafficRatio')}
              tooltip={t('pages.clients.trafficRatioDesc')}
            >
              <InputNumber style={{ width: '100%' }} step={0.1} min={0.1} />
            </FormField>
          </Form>
        </FormProvider>
      </Modal>
    </>
  );
}

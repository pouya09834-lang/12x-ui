import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfigProvider, Form, Input, Layout, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';

import { FormProvider, useForm } from 'react-hook-form';
import { HttpUtil } from '@/utils';
import { FormField, rhfZodValidate } from '@/components/form/rhf';
import { setMessageInstance } from '@/utils/messageBus';
import { useTheme } from '@/hooks/useTheme';
import { LoginFormSchema, type LoginFormValues } from '@/schemas/login';
import '@/pages/login/LoginPage.css';

type LoginForm = Pick<LoginFormValues, 'username' | 'password'>;

const basePath = window.X_UI_BASE_PATH || '';

export default function ResellerLoginPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);
  const methods = useForm<LoginForm>({ defaultValues: { username: '', password: '' } });

  useEffect(() => setMessageInstance(messageApi), [messageApi]);

  const onSubmit = useCallback(async (values: LoginForm) => {
    setSubmitting(true);
    try {
      const msg = await HttpUtil.post('/reseller/login', values);
      if (msg.success) window.location.href = basePath + 'reseller/app';
    } finally {
      setSubmitting(false);
    }
  }, []);

  const pageClass = ['login-app', isDark ? 'is-dark' : '', isUltra ? 'is-ultra' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      <Layout className={pageClass}>
        <Layout.Content className="login-content">
          <div className="login-wrapper">
            <div className="login-card">
              <div className="brand">
                <span className="brand-name">12X-UI</span>
                <span className="brand-accent" aria-hidden="true" />
              </div>
              <h2 className="welcome">
                <b>{t('pages.reseller.loginTitle')}</b>
              </h2>

              <FormProvider {...methods}>
                <Form
                  layout="vertical"
                  className="login-form"
                  onFinish={methods.handleSubmit(onSubmit)}
                >
                  <FormField
                    name="username"
                    label={t('username')}
                    rules={{ validate: rhfZodValidate(LoginFormSchema.shape.username) }}
                  >
                    <Input
                      prefix={<UserOutlined />}
                      autoComplete="username"
                      size="large"
                      placeholder={t('username')}
                      autoFocus
                    />
                  </FormField>

                  <FormField
                    name="password"
                    label={t('password')}
                    rules={{ validate: rhfZodValidate(LoginFormSchema.shape.password) }}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      autoComplete="current-password"
                      size="large"
                      placeholder={t('password')}
                    />
                  </FormField>

                  <Form.Item className="submit-row">
                    <Button type="primary" htmlType="submit" loading={submitting} size="large" block>
                      {t('login')}
                    </Button>
                  </Form.Item>
                </Form>
              </FormProvider>
            </div>
          </div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}

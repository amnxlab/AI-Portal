import React from 'react';
import {
    Card,
    Modal,
    Form,
    Button,
    Space,
    type CardProps,
    type ModalProps,
    type FormItemProps,
    type ButtonProps,
} from 'antd';
import { useTheme } from '../../theme/useTheme';
import { radius, space } from '../../theme/tokens';

/* ═══════════════════════════════════════════════════════════════
   Theme-aware form primitives.
   ───────────────────────────────────────────────────────────────
   The old form code duplicated the same hardcoded dark colours in
   every modal (background: token.surface, borderColor: token.border, ...).
   These components collapse that into one place and derive every
   colour from the active theme, so forms look correct in both dark
   and light mode.

   Rule of thumb:
     • Use <FormModal> for any modal that contains a form.
     • Use <FormCard> when a form lives inline on a page.
     • Use plain <Form.Item label="..."> (no manual Text colour) so
       Ant Design's ConfigProvider token drives the label.
     • Use plain <Input />, <Select />, <DatePicker />, etc. without
       inline background/border/colour styles.
   ═══════════════════════════════════════════════════════════════ */

interface FormModalProps extends Omit<ModalProps, 'onOk' | 'confirmLoading'> {
    open: boolean;
    onCancel: () => void;
    onOk?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    confirmLoading?: boolean;
    okText?: React.ReactNode;
    okButtonProps?: ButtonProps;
    cancelText?: React.ReactNode;
    cancelButtonProps?: ButtonProps;
    /** When true the primary action is rendered as a danger button. */
    danger?: boolean;
}

/** Modal shell tuned for forms. Header/body follow the active theme. */
export function FormModal({
    children,
    okText = 'Save',
    cancelText = 'Cancel',
    confirmLoading,
    okButtonProps,
    cancelButtonProps,
    danger,
    ...modalProps
}: FormModalProps) {
    const { t } = useTheme();

    return (
        <Modal
            {...modalProps}
            styles={{
                body:   { background: t.surface },
                header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                footer: { background: t.surface, borderTop: `1px solid ${t.border}` },
                mask:   { background: t.overlay },
                ...(modalProps.styles ?? {}),
            }}
            footer={modalProps.footer ?? (
                <Space>
                    <Button onClick={modalProps.onCancel} {...cancelButtonProps}>
                        {cancelText}
                    </Button>
                    <Button
                        type="primary"
                        loading={confirmLoading}
                        danger={danger}
                        onClick={modalProps.onOk}
                        {...okButtonProps}
                    >
                        {okText}
                    </Button>
                </Space>
            )}
        >
            {children}
        </Modal>
    );
}

interface FormCardProps extends CardProps {}

/** Card wrapper for inline page forms. */
export function FormCard({ children, ...cardProps }: FormCardProps) {
    const { t } = useTheme();
    return (
        <Card
            {...cardProps}
            style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: radius.lg,
                ...cardProps.style,
            }}
        >
            {children}
        </Card>
    );
}

interface ThemedFormItemProps extends FormItemProps {}

/** Form.Item that keeps labels aligned with the theme.
 *  Consumers should pass a plain string label; manual <Text> labels
 *  with hardcoded colours are unnecessary now. */
export function FormField({ children, ...props }: ThemedFormItemProps) {
    return <Form.Item {...props}>{children}</Form.Item>;
}

/** Standard action row for forms: Cancel / Primary action. */
export function FormActions({
    onCancel,
    onSubmit,
    submitText = 'Save',
    cancelText = 'Cancel',
    loading,
    danger,
}: {
    onCancel?: () => void;
    onSubmit?: () => void;
    submitText?: React.ReactNode;
    cancelText?: React.ReactNode;
    loading?: boolean;
    danger?: boolean;
}) {
    return (
        <Space style={{ marginTop: space.md }}>
            <Button onClick={onCancel}>{cancelText}</Button>
            <Button type="primary" loading={loading} danger={danger} onClick={onSubmit}>
                {submitText}
            </Button>
        </Space>
    );
}

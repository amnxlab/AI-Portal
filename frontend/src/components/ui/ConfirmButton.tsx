import type { ReactNode } from 'react';
import { Button, Popconfirm, Tooltip } from 'antd';
import type { ButtonProps } from 'antd';
import { useTheme } from '../../theme/useTheme';

interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick' | 'title'> {
    /** The question, phrased so the answer is obvious: 'Delete this task?' */
    title: ReactNode;
    /** Consequence, when it isn't reversible or affects others. */
    description?: ReactNode;
    onConfirm: () => void | Promise<void>;
    okText?: string;
    cancelText?: string;
    /** Hover hint on the trigger itself. */
    tooltip?: string;
    /** Skip the confirmation entirely — for when the action is reversible
     *  and the guard would just be friction. */
    skipConfirm?: boolean;
    children?: ReactNode;
}

/**
 * A destructive action with its confirmation attached.
 *
 * The app had 46 `<Popconfirm>`s against 34 `api.delete` calls, phrased
 * inconsistently ('Are you sure?', 'Delete?', 'Confirm delete') and with the
 * danger styling applied to some triggers but not others. Binding the guard
 * to the button means an unguarded destructive action has to be deliberate.
 */
export default function ConfirmButton({
    title,
    description,
    onConfirm,
    okText = 'Delete',
    cancelText = 'Cancel',
    tooltip,
    skipConfirm = false,
    danger = true,
    children,
    ...buttonProps
}: ConfirmButtonProps) {
    const { t } = useTheme();

    const trigger = (
        <Button
            danger={danger}
            {...buttonProps}
            onClick={skipConfirm ? () => void onConfirm() : undefined}
        >
            {children}
        </Button>
    );

    const wrapped = tooltip ? <Tooltip title={tooltip}>{trigger}</Tooltip> : trigger;

    if (skipConfirm) return wrapped;

    return (
        <Popconfirm
            title={title}
            description={description}
            onConfirm={() => void onConfirm()}
            okText={okText}
            cancelText={cancelText}
            okButtonProps={{ danger }}
            styles={{ root: { maxWidth: 300 } }}
            icon={
                <span aria-hidden style={{ color: danger ? t.danger : t.warning, marginRight: 4 }}>
                    ⚠
                </span>
            }
        >
            {wrapped}
        </Popconfirm>
    );
}

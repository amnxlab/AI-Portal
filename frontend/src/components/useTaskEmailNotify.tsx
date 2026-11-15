import { useState, useRef } from 'react';
import { Button, Tooltip, Modal, Typography, message } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import api from '../api/axios';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   Sending a task assignment by email, in one place.

   Three screens offer this — the task preview, the edit form, and the
   create form (as a tick box, so a new task never has to be saved and
   reopened just to tell somebody about it). They all go through here so
   the feedback, the double-press guard and the wording cannot drift
   apart.

   This never sends on its own. Every path is a deliberate act by the
   person at the keyboard, and the server is the authority on who the
   recipients are: it is handed a task id and nothing else.
   ═══════════════════════════════════════════════════════════════════════ */

interface Outcome { name: string; reason: string }

export interface NotifyResult {
    sent: string[];
    skipped: Outcome[];
    failed: Outcome[];
}

export function useTaskEmailNotify() {
    const [notifying, setNotifying] = useState(false);
    // Guards against a second press landing before the first reply, which a
    // `notifying` state check alone can miss between render and commit.
    const inFlight = useRef<string | null>(null);

    /**
     * Emails the assignees of one task. Reports and resolves; never throws.
     *
     * @returns true when at least one message went out.
     */
    const notify = async (taskId: string, opts?: { quiet?: boolean }): Promise<boolean> => {
        if (!taskId || inFlight.current === taskId) return false;
        inFlight.current = taskId;
        setNotifying(true);
        try {
            const { data } = await api.post<NotifyResult>(`/tasks/${taskId}/notify-email`);
            const sent = data.sent ?? [];
            const skipped = data.skipped ?? [];
            const failed = data.failed ?? [];

            if (sent.length && !skipped.length && !failed.length) {
                message.success(
                    sent.length === 1
                        ? `Assignment email sent to ${sent[0]}.`
                        : `Assignment email sent to ${sent.length} people.`,
                );
                return true;
            }

            // Anything other than a clean success has to survive being read,
            // so it is a dialog rather than a toast that slides away.
            const problems = [...failed, ...skipped];
            Modal[failed.length ? 'warning' : 'info']({
                title: sent.length
                    ? `Sent to ${sent.length}, ${problems.length} not sent`
                    : 'No email was sent',
                width: 520,
                okText: 'Close',
                content: (
                    <div style={{ marginTop: 10 }}>
                        {sent.length > 0 && (
                            <>
                                <Text style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Emailed:</Text>
                                <ul style={{ margin: '0 0 12px 18px', fontSize: 13 }}>
                                    {sent.map((n) => <li key={n}>{n}</li>)}
                                </ul>
                            </>
                        )}
                        {problems.length > 0 && (
                            <>
                                <Text style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Not emailed:</Text>
                                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                                    {problems.map((p) => (
                                        <li key={p.name} style={{ marginBottom: 3 }}>
                                            <strong>{p.name}</strong> &mdash; {p.reason}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </div>
                ),
            });
            return sent.length > 0;
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { message?: string } } })
                ?.response?.data?.message;
            // `quiet` is for the tick box on a create: the task itself saved
            // fine, and that success has already been reported, so this
            // failure is stated without implying the save went wrong.
            if (opts?.quiet) {
                Modal.warning({
                    title: 'The task was created, but the email was not sent',
                    width: 520,
                    okText: 'Close',
                    content: (
                        <div style={{ marginTop: 10 }}>
                            <Text style={{ fontSize: 13 }}>
                                {msg ?? 'The notification could not be sent.'}
                            </Text>
                            <Text style={{ fontSize: 12.5, display: 'block', marginTop: 10, opacity: 0.85 }}>
                                Open the task and use <strong>Notify by Email</strong> to try again.
                            </Text>
                        </div>
                    ),
                });
            } else {
                message.error(msg ?? 'Could not send the assignment email.');
            }
            return false;
        } finally {
            inFlight.current = null;
            setNotifying(false);
        }
    };

    return { notify, notifying };
}

/**
 * The button, wherever an existing task is on screen.
 *
 * Rendered only for people who may send it; the server checks for real and
 * refuses with a readable message if they may not.
 */
export function NotifyByEmailButton({
    taskId, hasAssignee, allowed, type = 'default', block, onSent,
}: {
    taskId?: string;
    /** Nothing to send to when false — the server would refuse anyway. */
    hasAssignee: boolean;
    allowed: boolean;
    type?: 'default' | 'primary' | 'text';
    block?: boolean;
    onSent?: () => void;
}) {
    const { notify, notifying } = useTaskEmailNotify();
    if (!allowed || !taskId) return null;

    return (
        <Tooltip
            title={hasAssignee
                ? 'Emails the assignee a formal assignment with a link to this task. Does not post to Discord.'
                : 'Nobody is assigned to this task, so there is no one to email.'}
        >
            <Button
                icon={<MailOutlined />}
                type={type}
                block={block}
                loading={notifying}
                disabled={!hasAssignee}
                onClick={async () => { if (await notify(taskId)) onSent?.(); }}
            >
                Notify by Email
            </Button>
        </Tooltip>
    );
}

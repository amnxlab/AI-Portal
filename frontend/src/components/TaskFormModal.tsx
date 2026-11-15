import { useEffect, useState, useCallback } from 'react';
import {
    Form, Input, Select, DatePicker, InputNumber, Row, Col, Space,
    Button, Checkbox, Tooltip, Typography,
} from 'antd';
import { MailOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api/axios';
import { FormModal } from './ui';
import { useTaskEmailNotify } from './useTaskEmailNotify';

const { Text } = Typography;

const COLUMNS = ['Todo', 'In Progress', 'Pending Review', 'Done', 'Needs Revision'] as const;

interface TaskData {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    projectId?: string;
    subProjectId?: string;
    deadline?: string;
    startDate?: string | null;
    estimatedHours?: number;
}

interface Project { id: string; name: string; }
interface UserDir {
    id: string;
    fullName: string;
    role?: string;
    permissions?: Record<string, boolean> | null;
}
interface ProjectMember extends UserDir {}

export interface TaskFormModalProps {
    open: boolean;
    onCancel: () => void;
    /**
     * Called with validated form values after Ok is clicked. Should throw on
     * API error.
     *
     * Returning the saved task lets a brand-new one be emailed about straight
     * away — the id only exists once the server has answered. Returning
     * nothing keeps the old behaviour, minus that.
     */
    onSave: (values: Record<string, any>) => Promise<void | { id?: string } | null>;
    saving: boolean;
    editTask?: TaskData | null;
    projects: Project[];
    allUsers: UserDir[];
    /** When set the project selector is hidden and this ID is always submitted. */
    fixedProjectId?: string;
    /** Default project pre-selected for new tasks (only when fixedProjectId is unset) */
    defaultProjectId?: string;
    /** True when the actor has global project/task authority (manage_projects). */
    canManageAll: boolean;
    /** True when the actor may set status "Done" (global authority or a
     *  task manager who is not merely a scoped project leader). */
    canMarkDone: boolean;
    currentUserId?: string;
    /** Optional colour function for project dot indicators */
    projectColor?: (id: string) => string;
    /** Initial status for new task form (ignored when editTask is set) */
    defaultStatus?: string;
    /**
     * Whether this actor may send the assignment email.
     *
     * Full project authority, or a leader of the task's project. The server
     * decides for real (`POST /tasks/:id/notify-email`); this only governs
     * whether the button is offered.
     */
    canNotifyByEmail?: boolean;
}

export default function TaskFormModal({
    open, onCancel, onSave, saving, editTask,
    projects, allUsers, fixedProjectId, defaultProjectId, canManageAll, canMarkDone, currentUserId,
    projectColor, defaultStatus = 'Todo', canNotifyByEmail = false,
}: TaskFormModalProps) {
    const [form] = Form.useForm();
    // Watched rather than read once: the email button turns on the moment
    // somebody is picked, without waiting for a save.
    const assigneeId = Form.useWatch('assigneeId', form) ?? editTask?.assigneeId;
    const [subProjects, setSubProjects] = useState<{ id: string; name: string }[]>([]);
    const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);

    const fetchSubProjects = useCallback(async (projectId: string | undefined) => {
        if (!projectId) { setSubProjects([]); setProjectMembers([]); return; }
        try {
            const [subRes, memRes] = await Promise.all([
                api.get(`/projects/${projectId}/subprojects`),
                api.get(`/projects/${projectId}/members`),
            ]);
            setSubProjects(subRes.data);
            setProjectMembers(
                (memRes.data as any[]).map(m => ({
                    id: m.user.id,
                    fullName: m.user.fullName,
                    role: m.user.role ?? '',
                    permissions: m.user.permissions ?? null,
                }))
            );
        } catch {
            setSubProjects([]);
            setProjectMembers([]);
        }
    }, []);

    // Populate form and fetch project data whenever the modal opens or editTask changes
    useEffect(() => {
        if (!open) return;
        const effectiveProjectId = editTask?.projectId ?? fixedProjectId;
        if (editTask) {
            form.setFieldsValue({
                ...editTask,
                deadline: editTask.deadline ? dayjs(editTask.deadline) : undefined,
                startDate: editTask.startDate ? dayjs(editTask.startDate) : undefined,
            });
            fetchSubProjects(effectiveProjectId);
        } else {
            form.resetFields();
            form.setFieldsValue({
                status: defaultStatus,
                priority: 'Medium',
                ...(fixedProjectId
                    ? { projectId: fixedProjectId }
                    : defaultProjectId ? { projectId: defaultProjectId } : {}),
            });
            fetchSubProjects(fixedProjectId ?? defaultProjectId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editTask, fixedProjectId, defaultStatus]);

    /*
     * "Notify by Email" — an explicit act, never a consequence of saving.
     *
     * On an existing task it is a button: press it and the email goes, with
     * no save involved. On a NEW task there is no id yet to point a link at,
     * so instead of a dead button and an instruction to save first, it is a
     * tick box that fires the moment the server hands back the new task.
     * Either way the person decides, and Discord is untouched.
     */
    const { notify, notifying } = useTaskEmailNotify();
    const [notifyOnCreate, setNotifyOnCreate] = useState(false);

    const handleOk = async () => {
        const values = await form.validateFields();
        if (values.deadline) values.deadline = values.deadline.format('YYYY-MM-DD');
        if (values.startDate) values.startDate = values.startDate.format('YYYY-MM-DD');
        // Ensure fixedProjectId is always present in payload if the form doesn't include the selector
        if (fixedProjectId && !values.projectId) values.projectId = fixedProjectId;

        const saved = await onSave(values);

        // A new task the person asked to announce. `quiet` because the save
        // itself already succeeded and has been reported — a failure here is
        // about the email, not the task.
        if (!editTask && notifyOnCreate && saved?.id) {
            await notify(saved.id, { quiet: true });
        }
    };

    const assigneeOptions = (
        projectMembers.length > 0 ? projectMembers : allUsers
    ).filter(u => {
        // Users with task-management authority cannot be assigned tasks by
        // someone without global authority — except themselves. This mirrors
        // the backend rule (assertAssigneeAssignable).
        const targetIsTaskAuthority = u.permissions?.manage_tasks === true;
        if (!canManageAll && targetIsTaskAuthority && u.id !== currentUserId) return false;
        return true;
    }).map(u => ({ label: u.fullName, value: u.id }));

    return (
        <FormModal
            title={editTask ? 'Edit Task' : 'Create Task'}
            open={open}
            onCancel={onCancel}
            onOk={handleOk}
            confirmLoading={saving}
            okText={editTask ? 'Save Task' : 'Create Task'}
            width={560}
            footer={
                <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                }}>
                    {/* Left: the email action, which stands apart from Save
                        because it is a separate decision. On an existing task
                        it sends now; there is no such thing on an unsaved one,
                        so the tick box in the form covers that instead. */}
                    <div>
                        {canNotifyByEmail && editTask?.id && (
                            <Tooltip
                                title={assigneeId
                                    ? 'Emails the assignee a formal assignment with a link to this task. Does not post to Discord.'
                                    : 'Assign somebody first. The email goes to the assignee.'}
                            >
                                <Button
                                    icon={<MailOutlined />}
                                    loading={notifying}
                                    disabled={!assigneeId}
                                    onClick={() => notify(editTask.id!)}
                                >
                                    Notify by Email
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                    <Space>
                        <Button onClick={onCancel}>Cancel</Button>
                        <Button type="primary" loading={saving} onClick={handleOk}>
                            {editTask ? 'Save Task' : 'Create Task'}
                        </Button>
                    </Space>
                </div>
            }
        >
            <Form
                form={form}
                layout="vertical"
                style={{ marginTop: 16 }}
                onValuesChange={(changed) => {
                    // When project changes (only relevant when project selector is visible),
                    // clear sub-project and assignee, then re-fetch data for the new project
                    if (!fixedProjectId && changed.projectId !== undefined) {
                        form.setFieldValue('subProjectId', undefined);
                        form.setFieldValue('assigneeId', undefined);
                        fetchSubProjects(changed.projectId);
                    }
                }}
            >
                {/* Title */}
                <Form.Item
                    name="title"
                    label="Title"
                    rules={[{ required: true }]}
                >
                    <Input />
                </Form.Item>

                {/* On a new task, the email rides along with the create.
                    Hidden on an edit, where the footer button sends directly. */}
                {canNotifyByEmail && !editTask && (
                    <Form.Item style={{ marginBottom: 12 }}>
                        <Checkbox
                            checked={notifyOnCreate && !!assigneeId}
                            disabled={!assigneeId}
                            onChange={(e) => setNotifyOnCreate(e.target.checked)}
                        >
                            <MailOutlined style={{ marginRight: 5 }} />
                            Email the assignee once the task is created
                        </Checkbox>
                        <div style={{ marginTop: 2 }}>
                            <Text type="secondary" style={{ fontSize: 11.5 }}>
                                {assigneeId
                                    ? 'A formal assignment email with the full description and a link to the task. Separate from Discord.'
                                    : 'Pick an assignee below to enable this.'}
                            </Text>
                        </div>
                    </Form.Item>
                )}

                {/* Description — Markdown, so the field says so. */}
                <Form.Item
                    name="description"
                    label="Description"
                    extra={
                        <span style={{ fontSize: 11 }}>
                            Markdown is supported: <code>**bold**</code>, <code>*italic*</code>,{' '}
                            <code># heading</code>, <code>- list</code>, <code>1. list</code>,{' '}
                            <code>[link](url)</code>, <code>`code`</code>, tables and <code>- [ ]</code> checklists.
                        </span>
                    }
                >
                    <Input.TextArea rows={5} placeholder="What needs doing. Markdown is rendered when the task is opened." />
                </Form.Item>

                {/* Row 1: Project (only when no fixed project) + Sub-Project */}
                <Row gutter={12}>
                    {!fixedProjectId && (
                        <Col span={12}>
                            <Form.Item
                                name="projectId"
                                label="Project"
                                rules={[{ required: true }]}
                            >
                                <Select
                                    options={projects.map(p => ({
                                        label: (
                                            <Space>
                                                {projectColor && (
                                                    <span style={{
                                                        display: 'inline-block', width: 8, height: 8,
                                                        borderRadius: '50%', background: projectColor(p.id),
                                                    }} />
                                                )}
                                                {p.name}
                                            </Space>
                                        ),
                                        value: p.id,
                                    }))}
                                />
                            </Form.Item>
                        </Col>
                    )}
                    <Col span={fixedProjectId ? 24 : 12}>
                        <Form.Item name="subProjectId" label="Sub-Project">
                            <Select
                                allowClear
                                placeholder="None"
                                options={subProjects.map(s => ({ value: s.id, label: s.name }))}
                            />
                        </Form.Item>
                    </Col>
                </Row>

                {/* Row 2: Status + Priority */}
                <Row gutter={12}>
                    <Col span={12}>
                        <Form.Item name="status" label="Status">
                            <Select
                                options={(canMarkDone ? [...COLUMNS] : COLUMNS.filter(c => c !== 'Done'))
                                    .map(c => ({ label: c, value: c }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="priority" label="Priority">
                            <Select options={['Low', 'Medium', 'High', 'Critical'].map(p => ({ label: p, value: p }))} />
                        </Form.Item>
                    </Col>
                </Row>

                {/* Row 3: Assignee + Deadline */}
                <Row gutter={12}>
                    <Col span={12}>
                        <Form.Item name="assigneeId" label="Assignee">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder={projectMembers.length > 0 ? 'Project members only' : 'Select assignee'}
                                options={assigneeOptions}
                            />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item name="deadline" label="Deadline">
                            <DatePicker style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>

                {/* Row 4: Start Date + Est. Hours */}
                <Row gutter={12}>
                    <Col span={12}>
                        <Form.Item
                            name="startDate"
                            label="Start Date (optional)"
                            extra="Leave empty to use assignment date"
                        >
                            <DatePicker style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        {/* Est. Hours — no weekly-cap constraint on estimation */}
                        <Form.Item name="estimatedHours" label="Est. Hours">
                            <InputNumber
                                min={0}
                                step={0.5}
                                style={{ width: '100%' }}
                            />
                        </Form.Item>
                    </Col>
                </Row>
            </Form>
        </FormModal>
    );
}

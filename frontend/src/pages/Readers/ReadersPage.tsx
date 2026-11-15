import { Space } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme';
import { PageHeader } from '../../components/ui';
import ReadersTab from '../Attendance/ReadersTab';

/* ═══════════════════════════════════════════════════════════════════════
   RFID readers — device administration, with its own address.

   This was the seventh tab of nine inside the Attendance page, and the tab
   strip is configured with `moreIcon={null}`, so what does not fit scrolls
   sideways instead of collapsing into a menu. On a laptop window the last
   three tabs were simply off the edge with nothing on screen to suggest
   they existed, which is how the only place to register a reader came to
   be unfindable.

   It is also the wrong shape for a tab. The rest of that page answers
   questions about people and hours; this one configures hardware, hands
   out an API key, and is what you open when a reader has stopped checking
   in — a thing you need most when something is wrong and least when you
   are reading attendance.

   The component itself is unchanged and still lives under Attendance/,
   because that is where its API and its siblings are. Only its route is
   new.
   ═══════════════════════════════════════════════════════════════════════ */

export default function ReadersPage() {
    const { t } = useTheme();

    return (
        <div style={{ padding: 24, background: t.bg, minHeight: '100vh' }}>
            <PageHeader
                title={<Space size={8}><ApiOutlined style={{ color: t.accent }} />RFID Readers</Space>}
                subtitle="The card readers that record on-site attendance — register a device, issue or rotate its API key, and watch what it reports"
            />

            <div style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                padding: '16px 24px',
                boxShadow: t.shadowSm,
            }}>
                <ReadersTab />
            </div>
        </div>
    );
}

import { Table } from 'antd';
import type { TableProps } from 'antd';
import { useTheme } from '../../theme/useTheme';
import { radius } from '../../theme/tokens';
import { EmptyState } from './States';

interface DataTableProps<T> extends Omit<TableProps<T>, 'locale'> {
    /** Minimum content width before horizontal scrolling kicks in.
     *  Set to `false` to opt out for genuinely narrow tables. */
    minWidth?: number | false;
    emptyTitle?: string;
    emptyDescription?: string;
}

/**
 * The standard table.
 *
 * Two things it fixes across the app's 54 tables:
 *
 *  1. Only 5 of them set `scroll`. The other 49 let wide content push the
 *     page into horizontal overflow instead of scrolling within the table.
 *     `minWidth` here defaults that behaviour on.
 *  2. Pagination was inconsistent — 23 tables disabled it outright and 13
 *     configured it differently. A shared default means long lists paginate
 *     the same way everywhere.
 */
export default function DataTable<T extends object>({
    minWidth = 720,
    emptyTitle = 'Nothing here yet',
    emptyDescription,
    pagination,
    scroll,
    size = 'middle',
    ...rest
}: DataTableProps<T>) {
    const { t } = useTheme();

    return (
        <Table<T>
            {...rest}
            size={size}
            scroll={scroll ?? (minWidth === false ? undefined : { x: minWidth })}
            pagination={
                pagination === false
                    ? false
                    : {
                        pageSize: 25,
                        showSizeChanger: true,
                        pageSizeOptions: ['10', '25', '50', '100'],
                        showTotal: (total, [from, to]) => `${from}–${to} of ${total}`,
                        size: 'small',
                        ...(typeof pagination === 'object' ? pagination : {}),
                    }
            }
            locale={{
                emptyText: (
                    <EmptyState compact title={emptyTitle} description={emptyDescription} />
                ),
            }}
            style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: radius.lg,
                overflow: 'hidden',
                ...rest.style,
            }}
        />
    );
}

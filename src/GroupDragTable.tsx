import React, { useState, useMemo, useContext, createContext } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import {
  DndContext,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { createPortal } from "react-dom";

/**
 * 说明：
 * - 每个“组头”都有 groupKey 和 groupSize（仅组头行含 groupSize）
 * - 每个行有唯一 key（这里用 key 字段）
 * - sort 字段会在拖动结束时按最终平铺顺序重写（0,1,2,...）
 *
 * ID 约定（用于 dnd-kit items）：
 * - 组头： "group:GROUPKEY"
 * - 行：   "row:ROWKEY"
 *
 * 这样 collisions 的 over 就会回传我们期望的 id。
 */

// ---------- 示例数据 ----------
interface RowItem {
  key: string;
  groupKey: string;
  groupSize?: number; // 仅组头行存在，否则 undefined
  category: string;
  name: string;
  count: number;
  sort: number; // 必须存在
}

const initialData: RowItem[] = [
  {
    key: "1-1",
    groupKey: "group-A",
    groupSize: 3,
    category: "A",
    name: "产品 A1",
    count: 10,
    sort: 0,
  },
  {
    key: "1-2",
    groupKey: "group-A",
    category: "A",
    name: "产品 A2",
    count: 20,
    sort: 1,
  },
  {
    key: "1-3",
    groupKey: "group-A",
    category: "A",
    name: "产品 A3",
    count: 30,
    sort: 2,
  },

  {
    key: "2-1",
    groupKey: "group-B",
    groupSize: 2,
    category: "B",
    name: "产品 B1",
    count: 5,
    sort: 3,
  },
  {
    key: "2-2",
    groupKey: "group-B",
    category: "B",
    name: "产品 B2",
    count: 15,
    sort: 4,
  },

  {
    key: "3-1",
    groupKey: "group-C",
    groupSize: 1,
    category: "C",
    name: "产品 C1",
    count: 40,
    sort: 5,
  },
];

// ---------- helpers ----------
const groupHeaders = (data: RowItem[]) =>
  data.filter((r) => r.groupSize !== undefined).map((h) => h.groupKey);

// 将数据按 groupKey 分块并保留顺序
const buildGroups = (data: RowItem[]) => {
  const map = new Map<string, RowItem[]>();
  // data assumed sorted by sort
  data.forEach((r) => {
    if (!map.has(r.groupKey)) map.set(r.groupKey, []);
    map.get(r.groupKey)!.push(r);
  });
  return Array.from(map.entries()).map(([groupKey, rows]) => ({
    groupKey,
    rows,
  }));
};

// flatten groups -> data array and reassign sort
const flattenAndResort = (groups: { groupKey: string; rows: RowItem[] }[]) => {
  let idx = 0;
  return groups.flatMap((g) =>
    g.rows.map((r) => ({
      ...r,
      sort: idx++,
    }))
  );
};

// ---------- RowContext & DragHandle ----------
interface RowCtx {
  setActivatorNodeRef?: (el: HTMLElement | null) => void;
  listeners?: any;
  isDragging?: boolean;
}
const RowContext = createContext<RowCtx>({});

const DragHandle: React.FC = () => {
  const ctx = useContext(RowContext);
  return (
    <MenuOutlined
      ref={ctx.setActivatorNodeRef as any}
      {...ctx.listeners}
      style={{ cursor: ctx.isDragging ? "grabbing" : "grab", color: "#1890ff" }}
    />
  );
};

// ---------- DraggableRow (用于 Table components.body.row) ----------
interface DraggableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  record: RowItem;
  "data-row-key": string;
  activeId: string | null;
}
const DraggableRow: React.FC<DraggableRowProps> = ({
  record,
  activeId,
  ...restProps
}) => {
  if (!record) return <tr {...restProps} />;

  // 是组头的判定（只有组头行含 groupSize 字段）
  const isGroupHeader = record.groupSize !== undefined;
  const activeIsGroup = activeId?.startsWith("group:");
  const activeIsRow = activeId?.startsWith("row:");

  // useSortable：如果是组头，启用 sortable id=group:groupKey；否则启用 row:id 以支持单行拖动
  const sortableId = isGroupHeader
    ? `group:${record.groupKey}`
    : `row:${record.key}`;
  // 禁用行为：如果是组头就启用 group 拖动；如果是普通行，启用 row 拖动
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: false });

  // 当某组正在拖动（group拖动），整组在原表格透明占位，单行拖动时只隐藏被拖的行
  const isCurrentGroupDragging = activeId === `group:${record.groupKey}`;
  const isCurrentRowDragging = activeId === `row:${record.key}`;

  const style: React.CSSProperties = {
    ...restProps.style,
    // 组拖动时，该组所有行都透明占位（占位但不可见）
    opacity: isCurrentGroupDragging ? 0 : isCurrentRowDragging ? 0 : 1,
    transition,
    // 对于组头我们可以保留 transform（不用于移动视觉，只让 dnd-kit 计算）
    transform: isGroupHeader ? CSS.Translate.toString(transform) : undefined,
  };

  const ctxValue = React.useMemo(
    () => ({ setActivatorNodeRef, listeners, isDragging }),
    [setActivatorNodeRef, listeners, isDragging]
  );

  return (
    <RowContext.Provider value={ctxValue}>
      <tr
        ref={isGroupHeader ? setNodeRef : undefined}
        {...(isGroupHeader ? attributes : {})}
        {...restProps}
        style={style}
      />
    </RowContext.Provider>
  );
};

// ---------- Overlay 渲染：整组或单行的镜像 ----------
// 如果 activeId 是 group:... 渲染整组；如果是 row:... 渲染那一行
const DragOverlayContent: React.FC<{
  activeId: string | null;
  data: RowItem[];
}> = ({ activeId, data }) => {
  if (!activeId) return null;
  if (activeId.startsWith("group:")) {
    const groupKey = activeId.slice("group:".length);
    const rows = data
      .filter((r) => r.groupKey === groupKey)
      .sort((a, b) => a.sort - b.sort);
    return (
      <div
        style={{
          background: "#fff",
          boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
          border: "1px solid #e8e8e8",
          width: 800,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 60 }} />
            <col style={{ width: 120 }} />
            <col />
            <col style={{ width: 100 }} />
          </colgroup>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.key}
                style={{ height: 52, borderBottom: "1px solid #f0f0f0" }}
              >
                <td
                  style={{
                    textAlign: "center",
                    borderRight: "1px solid #f0f0f0",
                  }}
                >
                  {i === 0 && <MenuOutlined style={{ color: "#1890ff" }} />}
                </td>
                <td
                  style={{
                    textAlign: "center",
                    borderRight: "1px solid #f0f0f0",
                  }}
                >
                  {i === 0 && r.category}
                </td>
                <td style={{ padding: 12 }}>{r.name}</td>
                <td style={{ padding: 12 }}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (activeId.startsWith("row:")) {
    const rowKey = activeId.slice("row:".length);
    const r = data.find((x) => x.key === rowKey);
    if (!r) return null;
    return (
      <div
        style={{
          background: "#fff",
          boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
          border: "1px solid #e8e8e8",
          width: 800,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 60 }} />
            <col style={{ width: 120 }} />
            <col />
            <col style={{ width: 100 }} />
          </colgroup>
          <tbody>
            <tr style={{ height: 52, borderBottom: "1px solid #f0f0f0" }}>
              <td
                style={{
                  textAlign: "center",
                  borderRight: "1px solid #f0f0f0",
                }}
              >
                <MenuOutlined style={{ color: "#1890ff" }} />
              </td>
              <td
                style={{
                  textAlign: "center",
                  borderRight: "1px solid #f0f0f0",
                }}
              >
                {r.category}
              </td>
              <td style={{ padding: 12 }}>{r.name}</td>
              <td style={{ padding: 12 }}>{r.count}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
  return null;
};

// ---------- Main component ----------
const TableWithGroupAndRowDrag: React.FC = () => {
  const [dataSource, setDataSource] = useState<RowItem[]>(initialData);
  const [activeId, setActiveId] = useState<string | null>(null);

  // sortedData 按 sort 保证渲染顺序
  const sortedData = useMemo(
    () => [...dataSource].sort((a, b) => a.sort - b.sort),
    [dataSource]
  );
  const groups = useMemo(() => buildGroups(sortedData), [sortedData]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // items for SortableContext: include group ids and row ids (as used above)
  const sortableItems = useMemo(() => {
    // We'll expose only group headers and row keys as items so collisions detect both types
    const groupIds = groups.map((g) => `group:${g.groupKey}`);
    const rowIds = sortedData.map((r) => `row:${r.key}`);
    return [...groupIds, ...rowIds];
  }, [groups, sortedData]);

  // drag start: record active id
  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  // drag end: 重写数据结构：分4种情况
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    // active is group move
    if (activeIdStr.startsWith("group:") && overIdStr.startsWith("group:")) {
      const activeGroupKey = activeIdStr.slice("group:".length);
      const overGroupKey = overIdStr.slice("group:".length);
      // reorder groups: move activeGroup to position of overGroup
      const headerOrder = groups.map((g) => g.groupKey);
      const from = headerOrder.indexOf(activeGroupKey);
      const to = headerOrder.indexOf(overGroupKey);
      if (from === -1 || to === -1 || from === to) return;
      const newHeaderOrder = arrayMove(headerOrder, from, to);
      // rebuild groups in new order and flatten (preserve internal row order)
      const newGroups = newHeaderOrder.map(
        (gk) => groups.find((g) => g.groupKey === gk)!
      );
      const newData = flattenAndResort(newGroups);
      setDataSource(newData);
      return;
    }

    // active is row move
    if (activeIdStr.startsWith("row:")) {
      const rowKey = activeIdStr.slice("row:".length);

      // case a: dropped on a group header -> append to that group (at end)
      if (overIdStr.startsWith("group:")) {
        const targetGroupKey = overIdStr.slice("group:".length);
        // remove row from its old group and append to target group
        const oldGroups = groups.map((g) => ({
          groupKey: g.groupKey,
          rows: [...g.rows],
        }));
        let moving: RowItem | undefined;
        oldGroups.forEach((g) => {
          const idx = g.rows.findIndex((r) => r.key === rowKey);
          if (idx >= 0) moving = g.rows.splice(idx, 1)[0];
        });
        if (!moving) return;
        // update moving's groupKey
        moving.groupKey = targetGroupKey;
        // append
        const t = oldGroups.find((g) => g.groupKey === targetGroupKey)!;
        t.rows.push(moving);
        // flatten and resort
        const newData = flattenAndResort(oldGroups);
        setDataSource(newData);
        return;
      }

      // case b: dropped on another row -> insert before/after depending on positions
      if (overIdStr.startsWith("row:")) {
        const targetRowKey = overIdStr.slice("row:".length);

        // build modifiable groups
        const oldGroups = groups.map((g) => ({
          groupKey: g.groupKey,
          rows: [...g.rows],
        }));

        // find source and target
        let moving: RowItem | undefined;
        for (const g of oldGroups) {
          const idx = g.rows.findIndex((r) => r.key === rowKey);
          if (idx >= 0) {
            moving = g.rows.splice(idx, 1)[0];
            break;
          }
        }
        if (!moving) return;

        // find target group & index
        let placed = false;
        for (const g of oldGroups) {
          const idx = g.rows.findIndex((r) => r.key === targetRowKey);
          if (idx >= 0) {
            // insert before the target row (you can change behavior to insert after)
            moving.groupKey = g.groupKey;
            g.rows.splice(idx, 0, moving);
            placed = true;
            break;
          }
        }
        if (!placed) {
          // fallback append to last group
          oldGroups[oldGroups.length - 1].rows.push(moving);
        }
        const newData = flattenAndResort(oldGroups);
        setDataSource(newData);
        return;
      }
    }

    // other cases ignored
  };

  // Columns: use onCell to set rowSpan for group merge, and render DragHandle only on group header
  const columns: ColumnsType<RowItem> = [
    {
      title: "拖动",
      width: 60,
      render: (_, record) => (record.groupSize ? <DragHandle /> : null),
      onCell: (_, index) => {
        const rec = sortedData[index];
        return { rowSpan: rec.groupSize || 0 };
      },
    },
    {
      title: "组",
      dataIndex: "category",
      width: 120,
      onCell: (_, index) => {
        const rec = sortedData[index];
        return { rowSpan: rec.groupSize || 0 };
      },
    },
    { title: "名称", dataIndex: "name" },
    { title: "数量", dataIndex: "count", width: 100 },
  ];

  return (
    <div style={{ padding: 16 }}>
      <h3>AntD Table - 组拖动 + 单行拖动 + 合并行（最终版）</h3>

      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={sortableItems}
          strategy={verticalListSortingStrategy}
        >
          <Table<RowItem>
            components={{ body: { row: DraggableRow } }}
            rowKey="key"
            columns={columns}
            dataSource={sortedData}
            pagination={false}
            bordered
            style={{ width: 800 }}
            onRow={(record) =>
              ({ record, activeId, "data-row-key": record.key } as any)
            }
          />
        </SortableContext>

        {createPortal(
          <DragOverlay
            dropAnimation={{
              sideEffects: defaultDropAnimationSideEffects({
                styles: { active: { opacity: "0.0" } },
              }),
            }}
          >
            <DragOverlayContent activeId={activeId} data={dataSource} />
          </DragOverlay>,
          document.body
        )}
      </DndContext>
    </div>
  );
};

export default TableWithGroupAndRowDrag;

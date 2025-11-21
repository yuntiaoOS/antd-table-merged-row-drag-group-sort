// @ts-nocheck
import React, { useState, useMemo, useContext, createContext } from "react";
import { Table } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import {
  DndContext,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  DragMoveEvent,
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

/* ============ 数据结构 ============ */
interface RowItem {
  key: string;
  groupKey: string;
  groupSize?: number;
  category: string;
  name: string;
  count: number;
  sort: number; // must exist, initialized 1,2,3...
}

/* 初始化示例数据（sort 从 1 开始） */
const initialData: RowItem[] = [
  {
    key: "1-1",
    groupKey: "group-A",
    groupSize: 3,
    category: "A",
    name: "产品 A1",
    count: 10,
    sort: 1,
  },
  {
    key: "1-2",
    groupKey: "group-A",
    category: "A",
    name: "产品 A2",
    count: 20,
    sort: 2,
  },
  {
    key: "1-3",
    groupKey: "group-A",
    category: "A",
    name: "产品 A3",
    count: 30,
    sort: 3,
  },

  {
    key: "2-1",
    groupKey: "group-B",
    groupSize: 2,
    category: "B",
    name: "产品 B1",
    count: 5,
    sort: 4,
  },
  {
    key: "2-2",
    groupKey: "group-B",
    category: "B",
    name: "产品 B2",
    count: 15,
    sort: 5,
  },

  {
    key: "3-1",
    groupKey: "group-C",
    groupSize: 1,
    category: "C",
    name: "产品 C1",
    count: 40,
    sort: 6,
  },
];

/* ============ helpers ============ */
const buildGroups = (data: RowItem[]) => {
  const map = new Map<string, RowItem[]>();
  data.forEach((r) => {
    if (!map.has(r.groupKey)) map.set(r.groupKey, []);
    map.get(r.groupKey)!.push(r);
  });
  // preserve order by smallest sort of group
  return Array.from(map.entries()).map(([groupKey, rows]) => ({
    groupKey,
    rows: rows.slice().sort((a, b) => a.sort - b.sort),
  }));
};

const flattenAndResort = (groups: { groupKey: string; rows: RowItem[] }[]) => {
  // produce new array and ensure sort values preserved where not changed
  return groups.flatMap((g) => g.rows);
};

/* 找 prev/next sort value (strict) */
const findPrevSort = (data: RowItem[], sort: number) => {
  const arr = data.filter((i) => i.sort < sort).sort((a, b) => a.sort - b.sort);
  if (arr.length === 0) return null;
  return arr[arr.length - 1].sort;
};
const findNextSort = (data: RowItem[], sort: number) => {
  const arr = data.filter((i) => i.sort > sort).sort((a, b) => a.sort - b.sort);
  if (arr.length === 0) return null;
  return arr[0].sort;
};

/* update single row sort */
const updateRowSort = (data: RowItem[], rowKey: string, newSort: number) =>
  data.map((r) => (r.key === rowKey ? { ...r, sort: newSort } : r));

/* update group sort: set group's rows to up + JQ * index (index from 1..rowNum) */
const updateGroupSort = (
  data: RowItem[],
  groupKey: string,
  up: number,
  JQ: number
) => {
  let idx = 1;
  return data.map((r) =>
    r.groupKey === groupKey ? { ...r, sort: up + JQ * idx++ } : r
  );
};

/* ============ RowContext & DragHandle ============ */
const RowContext = createContext({
  setActivatorNodeRef: undefined,
  listeners: undefined,
  isDragging: false,
});

const DragHandle: React.FC = () => {
  const ctx: any = useContext(RowContext);
  return (
    <div
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        background: "#fafafa",
        border: "1px solid #e8e8e8",
      }}
      className="drag-handle"
    >
      <MenuOutlined ref={ctx.setActivatorNodeRef as any} {...ctx.listeners} />
    </div>
  );
};

/* ============ DraggableRow (Table body row) ============ */
const DraggableRow = ({ record, activeId, ...restProps }: any) => {
  if (!record) return <tr {...restProps} />;

  const isGroupHeader = record.groupSize !== undefined;
  const sortableId = isGroupHeader
    ? `group:${record.groupKey}`
    : `row:${record.key}`;

  const sortable = useSortable({ id: sortableId, disabled: false });
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  // 修复点：判断当前行是否属于正在拖动的组（无论是否是组头行）
  const isCurrentGroupDragging =
    activeId &&
    activeId.startsWith("group:") &&
    record.groupKey === activeId.replace("group:", "");
  const isCurrentRowDragging = activeId === `row:${record.key}`;

  const style: React.CSSProperties = {
    ...restProps.style,
    opacity: isCurrentGroupDragging || isCurrentRowDragging ? 0 : 1,
    transition: transition || "all 120ms ease",
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
        className={`${restProps.className || ""} ${
          isCurrentGroupDragging ? "group-dragging" : ""
        }`}
        style={style}
      />
    </RowContext.Provider>
  );
};

/* ============ DragOverlay UI ============ */
const DragOverlayContent = ({
  activeId,
  data,
}: {
  activeId: string | null;
  data: RowItem[];
}) => {
  if (!activeId) return null;
  if (activeId.startsWith("group:")) {
    const groupKey = activeId.replace("group:", "");
    const rows = data
      .filter((r) => r.groupKey === groupKey)
      .sort((a, b) => a.sort - b.sort);
    return (
      <div
        className="dnd-overlay-animate"
        style={{ background: "#fff", border: "1px solid #e8e8e8", width: 900 }}
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
            <col style={{ width: 140 }} />
            <col />
            <col style={{ width: 120 }} />
          </colgroup>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.key}
                style={{ height: 56, borderBottom: "1px solid #f0f0f0" }}
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
                <td style={{ padding: 14 }}>{r.name}</td>
                <td style={{ padding: 14 }}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    const rowKey = activeId.replace("row:", "");
    const r = data.find((x) => x.key === rowKey);
    if (!r) return null;
    return (
      <div
        className="dnd-overlay-animate"
        style={{ background: "#fff", border: "1px solid #e8e8e8", width: 900 }}
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
            <col style={{ width: 140 }} />
            <col />
            <col style={{ width: 120 }} />
          </colgroup>
          <tbody>
            <tr style={{ height: 56, borderBottom: "1px solid #f0f0f0" }}>
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
              <td style={{ padding: 14 }}>{r.name}</td>
              <td style={{ padding: 14 }}>{r.count}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
};

/* ============ Sort calculation per your spec ============ */
/**
 * activeId/overId are id strings like "group:groupKey" or "row:rowKey"
 * sortedData is current data (sorted by sort)
 * This function returns a new array where only the active row(s) sort are changed.
 */
function computeNewSorts(
  sortedData: RowItem[],
  activeId: string,
  overId: string
) {
  // helper to get numeric sort for an id (row or group head)
  const getSortForId = (id: string, isTargetingEnd = false) => {
    if (id.startsWith("row:")) {
      const k = id.slice("row:".length);
      const r = sortedData.find((x) => x.key === k);
      return r ? r.sort : null;
    } else if (id.startsWith("group:")) {
      const gk = id.slice("group:".length);
      const rows = sortedData
        .filter((x) => x.groupKey === gk)
        .sort((a, b) => a.sort - b.sort);
      if (rows.length === 0) return null;
      return isTargetingEnd ? rows[rows.length - 1].sort : rows[0].sort;
    }
    return null;
  };

  // helper to find prev/next sort for a given sort number
  const findPrev = (s: number | null) =>
    s == null ? null : findPrevSort(sortedData, s);
  const findNext = (s: number | null) =>
    s == null ? null : findNextSort(sortedData, s);

  const activeIsGroup = activeId.startsWith("group:");
  const activeIsRow = activeId.startsWith("row:");
  const overIsGroup = overId.startsWith("group:");
  const overIsRow = overId.startsWith("row:");

  // 1. 获取 active 项的 sort (组取第一行)
  const activeSort = getSortForId(activeId, false); // 活动项总是取第一行的 sort

  // 2. 先获取 over 项的 sort 作为基准来判断方向 (组先取第一行)
  const overSortBase = getSortForId(overId, false);

  // guard
  if (activeSort == null || overSortBase == null) return sortedData;

  // 3. 使用基准 sort 值判断方向
  const isUp = activeSort > overSortBase;
  const isDown = activeSort < overSortBase;

  // 4. 根据方向，重新获取 over 项的正确 sort 值
  //    - 如果是向上拖动，over 项的 sort 应该是它的起始位置（第一行）
  //    - 如果是向下拖动，over 项的 sort 应该是它的结束位置（最后一行）
  //    - 但对于单行，这两个值是一样的，所以逻辑也成立。
  const overSort = getSortForId(overId, isDown); // ✅ 根据方向决定取组的哪一端

  // clone data to mutate sorts for the active only
  let newData = sortedData.map((r) => ({ ...r }));

  // ---------- Row case ----------
  if (activeIsRow && !activeIsGroup) {
    const activeKey = activeId.slice("row:".length);

    if (isUp) {
      // up -> over is down
      const down = overSort;
      const up = findPrev(down) ?? 0;
      const newSort = (down - up) / 2 + up;
      newData = updateRowSort(newData, activeKey, newSort);
      return newData;
    }

    if (isDown) {
      // down -> over is up
      const up = overSort;
      const maybeNext = findNext(up);
      const down = maybeNext ?? up + 2;
      const newSort = up + (down - up) / 2;
      newData = updateRowSort(newData, activeKey, newSort);
      return newData;
    }

    return newData;
  }

  // ---------- Group case ----------
  if (activeIsGroup) {
    const gk = activeId.slice("group:".length);
    const rows = sortedData
      .filter((r) => r.groupKey === gk)
      .sort((a, b) => a.sort - b.sort);
    const rowNum = rows.length;

    if (isUp) {
      // up -> over is down
      const down = overSort;
      const up = findPrev(down) ?? 0;
      const JQ = (down - up) / (rowNum + 1);
      newData = updateGroupSort(newData, gk, up, JQ);
      return newData;
    }

    if (isDown) {
      const up = overSort;
      const maybeNext = findNext(up);
      const down = maybeNext ?? up + rowNum + 1;
      const JQ = (down - up) / (rowNum + 1);
      newData = updateGroupSort(newData, gk, up, JQ);
      return newData;
    }

    return newData;
  }

  return newData;
}

/* ============ Main component ============ */
const TableWithGroupAndRowDrag: React.FC = () => {
  const [dataSource, setDataSource] = useState<RowItem[]>(initialData);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indicatorPos, setIndicatorPos] = useState<{
    key: string;
    type: "before" | "after";
  } | null>(null);

  const sortedData = useMemo(
    () => [...dataSource].sort((a, b) => a.sort - b.sort),
    [dataSource]
  );
  const groups = useMemo(() => buildGroups(sortedData), [sortedData]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const sortableItems = useMemo(() => {
    const groupIds = groups.map((g) => `group:${g.groupKey}`);
    const rowIds = sortedData.map((r) => `row:${r.key}`);
    return [...groupIds, ...rowIds];
  }, [groups, sortedData]);

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const onDragMove = (e: DragMoveEvent) => {
    // auto scroll
    try {
      const tableEl = document.querySelector(
        ".ant-table-body"
      ) as HTMLElement | null;
      if (tableEl && e.activatorEvent && (e.activatorEvent as any).clientY) {
        const rect = tableEl.getBoundingClientRect();
        const mouseY = (e.activatorEvent as any).clientY;
        const threshold = 80;
        const speed = 10;
        if (mouseY < rect.top + threshold) tableEl.scrollTop -= speed;
        else if (mouseY > rect.bottom - threshold) tableEl.scrollTop += speed;
      }
    } catch (err) {
      // ignore
    }

    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) {
      setIndicatorPos(null);
      return;
    }

    // 当 overId 是组时，指示线应该显示在该组的最后一行下面
    if (overId.startsWith("group:")) {
      const gk = overId.slice("group:".length);
      const rows = sortedData
        .filter((r) => r.groupKey === gk)
        .sort((a, b) => a.sort - b.sort);
      if (rows.length > 0) {
        const lastRowKey = rows[rows.length - 1].key;
        setIndicatorPos({ key: lastRowKey, type: "after" }); // 显示在最后一行之后
      }
    } else {
      // 单行情况不变
      setIndicatorPos({ key: overId.replace("row:", ""), type: "before" });
    }
  };

  const recomputeGroupSizes = (data: RowItem[]) => {
    const groups = buildGroups(data);
    return groups.flatMap((g) => {
      const size = g.rows.length;
      return g.rows.map((r, idx) => ({
        ...r,
        groupSize: idx === 0 ? size : 0, // 只有第一行显示 rowSpan
      }));
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setIndicatorPos(null);
    setActiveId(null);
    if (!active || !over) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    // compute new sorts based on your algorithm
    const newData = computeNewSorts(sortedData, activeIdStr, overIdStr);

    // after computing, we re-normalize sort values to prevent floating explosion:
    // Optionally: we can sort by new sort and reassign integer ranks 1..N to keep simplicity.
    // But per your spec, we should preserve fractional sorts (allows inserting many times).
    // We'll keep the fractional sort but if differences very small we may renormalize.
    const dataWithSizes = recomputeGroupSizes(newData);
    setDataSource(dataWithSizes);
    // setDataSource(() => {
    //   // Ensure stable: return array sorted by sort
    //   const arr = [...newData].sort((a, b) => a.sort - b.sort);
    //   // Optional reindex to 1..N to avoid floats growing small: comment/uncomment depending preference
    //   // const reindexed = arr.map((r, idx) => ({ ...r, sort: idx + 1 }));
    //   // return reindexed;
    //   return arr;
    // });
  };

  // Columns with onCell rowSpan and render for handle only on group header
  const columns = [
    {
      title: "拖动",
      width: 64,
      render: (_: any, record: RowItem) =>
        record.groupSize ? <DragHandle /> : null,
      onCell: (_: any, index: number) => {
        const rec = sortedData[index];
        return { rowSpan: rec.groupSize || 0 };
      },
    },
    {
      title: "组",
      dataIndex: "category",
      width: 140,
      onCell: (_: any, index: number) => {
        const rec = sortedData[index];
        return { rowSpan: rec.groupSize || 0 };
      },
    },
    { title: "名称", dataIndex: "name" },
    { title: "数量", dataIndex: "count", width: 120 },
  ];

  return (
    <div style={{ padding: 20 }}>
      <h3>
        AntD Table — 豪华版：组拖动 + 单行拖动 + 合并行 + 指示线 + 自动滚动 +
        sort 算法
      </h3>

      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
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
            style={{ width: 900 }}
            onRow={(record) =>
              ({ record, activeId, "data-row-key": record.key } as any)
            }
            rowClassName={(record) =>
              indicatorPos?.key === record.key && indicatorPos.type === "before"
                ? "drop-indicator-row"
                : ""
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

      {/* ===== CSS (局部内嵌，推荐搬到全局样式文件) ===== */}
      <style>{`
        /* row hover */
        .ant-table-tbody > tr:hover td {
          background: #f5fbff !important;
          transition: all 0.18s ease;
        }
        /* drag handle hover */
        .drag-handle:hover {
          transform: scale(1.07);
          filter: drop-shadow(0 4px 8px rgba(24,144,255,0.12));
        }
        /* group dragging placeholder (original rows) */
        tr.group-dragging td {
          background: rgba(24,144,255,0.04) !important;
          transition: all 0.12s ease;
          border-left: 4px solid rgba(24,144,255,0.18);
        }
        /* drop indicator */
        .drop-indicator-row td {
          border-top: 3px solid #1677ff !important;
          animation: dropBlink 0.6s linear infinite alternate;
        }
        @keyframes dropBlink {
          0% { border-color: #1677ff; }
          100% { border-color: #69c0ff; }
        }
        /* overlay look */
        .dnd-overlay-animate {
          transform: scale(1.02);
          box-shadow: 0 16px 36px rgba(15, 37, 71, 0.18);
          border-radius: 6px;
          transition: all 0.12s ease;
        }
      `}</style>
    </div>
  );
};

export default TableWithGroupAndRowDrag;

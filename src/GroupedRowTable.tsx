import React, { useState, useMemo, useContext, createContext } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import {
  DndContext,
  DragEndEvent,
  useSensor,
  useSensors,
  PointerSensor,
  DragOverlay,
  DragStartEvent,
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

// --- 1. 数据定义 ---
interface DataType {
  key: string;
  groupKey: string;
  groupSize?: number;
  category: string;
  name: string;
  count: number;
  sort: number; // 必须有 sort 字段
}

const initialData: DataType[] = [
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

const getGroupKeys = (data: DataType[]) =>
  data
    .filter((item) => item.groupSize !== undefined)
    .map((item) => item.groupKey);

// --- 2. 排序逻辑 (重写 sort 值) ---
const reorderGroups = (
  data: DataType[],
  activeGroupKey: string,
  overGroupKey: string
): DataType[] => {
  const groupHeaders = data.filter((item) => item.groupSize !== undefined);
  const oldIndex = groupHeaders.findIndex((h) => h.groupKey === activeGroupKey);
  const newIndex = groupHeaders.findIndex((h) => h.groupKey === overGroupKey);

  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return data;

  // 移动组头
  const newGroupOrder = arrayMove(groupHeaders, oldIndex, newIndex);

  // 重建数据并重写 sort
  let currentSortIndex = 0;
  const newSortedData: DataType[] = [];

  newGroupOrder.forEach((header) => {
    const groupRows = data
      .filter((item) => item.groupKey === header.groupKey)
      .sort((a, b) => a.sort - b.sort);

    groupRows.forEach((row) => {
      newSortedData.push({ ...row, sort: currentSortIndex++ });
    });
  });

  return newSortedData;
};

// --- 3. Context ---
interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: any;
  isDragging?: boolean; // 是否正在被拖动
}
const RowContext = createContext<RowContextProps>({});

// 拖动 Handle 图标
const DragHandle: React.FC = () => {
  const { setActivatorNodeRef, listeners, isDragging } = useContext(RowContext);
  return (
    <MenuOutlined
      ref={setActivatorNodeRef}
      {...listeners}
      style={{
        cursor: isDragging ? "grabbing" : "grab",
        color: "#999",
      }}
    />
  );
};

// --- 4. 自定义行组件 (关键修改) ---
interface DraggableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  "data-row-key": string;
  record: DataType;
  activeId: string | null; // 传入当前正在拖动的 ID
}

const DraggableRow: React.FC<DraggableRowProps> = ({
  record,
  activeId,
  ...restProps
}) => {
  if (!record) return <tr {...restProps} />;

  const isGroupHeader = record.groupSize !== undefined;
  const isCurrentGroupDragging = activeId === record.groupKey;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: record.groupKey,
    disabled: !isGroupHeader,
  });

  const style: React.CSSProperties = {
    ...restProps.style,
    // 注意：我们不使用 transform 来移动原始行，因为这只会移动第一行。
    // 我们依靠 DragOverlay 来显示移动效果。
    // 这里我们只需要处理“隐藏原始位置”的逻辑。

    // 如果当前行属于正在拖动的组，将其透明度设为 0 (看不见但占位)
    // 或者是 isDragging (组头本身)
    opacity: isCurrentGroupDragging ? 0 : 1,

    transition, // 保持 transition 以便其他非拖动行平滑让位
    transform: CSS.Translate.toString(transform), // 让非拖动行让位动画生效
  };

  const contextValue = useMemo(
    () => ({ setActivatorNodeRef, listeners, isDragging }),
    [setActivatorNodeRef, listeners, isDragging]
  );

  return (
    <RowContext.Provider value={contextValue}>
      <tr
        ref={isGroupHeader ? setNodeRef : null}
        {...restProps}
        {...(isGroupHeader ? attributes : {})}
        style={style}
      />
    </RowContext.Provider>
  );
};

// --- 5. 替身组件 (Overlay Content) ---
// 这个组件负责渲染“看起来像整个组”的表格片段
const DragOverlayGroup = ({
  groupKey,
  data,
}: {
  groupKey: string;
  data: DataType[];
}) => {
  const groupRows = data
    .filter((r) => r.groupKey === groupKey)
    .sort((a, b) => a.sort - b.sort);

  return (
    <div
      style={{
        background: "#fff",
        boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
        border: "1px solid #e8e8e8",
        width: "600px", // 需要匹配主表格宽度
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
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 80 }} />
        </colgroup>
        <tbody>
          {groupRows.map((row, index) => (
            <tr
              key={row.key}
              style={{ height: "55px", borderBottom: "1px solid #f0f0f0" }}
            >
              {/* 只有第一行渲染 Handle 和 Category */}
              <td
                style={{
                  textAlign: "center",
                  borderRight: "1px solid #f0f0f0",
                }}
              >
                {index === 0 && <MenuOutlined style={{ color: "#1890ff" }} />}
              </td>
              <td
                style={{
                  textAlign: "center",
                  borderRight: "1px solid #f0f0f0",
                }}
              >
                {index === 0 && row.category}
              </td>
              <td style={{ padding: "16px" }}>{row.name}</td>
              <td style={{ padding: "16px" }}>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// --- 6. 主组件 ---

const TableWithMultiRowDrag: React.FC = () => {
  const [dataSource, setDataSource] = useState(initialData);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 确保数据始终有序
  const sortedData = useMemo(
    () => [...dataSource].sort((a, b) => a.sort - b.sort),
    [dataSource]
  );
  const groupItems = useMemo(() => getGroupKeys(sortedData), [sortedData]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      setDataSource((prev) =>
        reorderGroups(prev, String(active.id), String(over.id))
      );
    }
  };

  const columns: ColumnsType<DataType> = [
    {
      title: "排序",
      width: 60,
      align: "center",
      render: (_, record) => (record.groupSize ? <DragHandle /> : null),
      onCell: (record) => ({ rowSpan: record.groupSize || 0 }),
    },
    {
      title: "分组",
      dataIndex: "category",
      width: 100,
      align: "center",
      onCell: (record) => ({ rowSpan: record.groupSize || 0 }),
    },
    { title: "产品名称", dataIndex: "name" },
    { title: "数量", dataIndex: "count", width: 80 },
  ];

  return (
    <div style={{ padding: 20 }}>
      <h3>多行合并整组拖动 (完美版)</h3>
      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={groupItems}
          strategy={verticalListSortingStrategy}
        >
          <Table<DataType>
            // 将 activeId 传给 Body，以便传给 Row
            components={{ body: { row: DraggableRow } }}
            rowKey="key"
            columns={columns}
            dataSource={sortedData}
            pagination={false}
            bordered
            style={{ width: 600 }}
            // 关键：传递 activeId 给每一行
            onRow={(record) =>
              ({
                record,
                activeId,
                "data-row-key": record.key,
              } as any)
            }
          />
        </SortableContext>

        {/* 渲染替身 */}
        {createPortal(
          <DragOverlay
            dropAnimation={{
              sideEffects: defaultDropAnimationSideEffects({
                styles: { active: { opacity: "0.0" } }, // 隐藏原始的 dnd-kit 镜像，使用我们自定义的
              }),
            }}
          >
            {activeId ? (
              <DragOverlayGroup groupKey={activeId} data={dataSource} />
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </DndContext>
    </div>
  );
};

export default TableWithMultiRowDrag;

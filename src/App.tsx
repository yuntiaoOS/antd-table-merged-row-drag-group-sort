import React from "react";
import GroupedRowTable from "./GroupedRowTable";
import GroupDragTable from "./GroupDragTable";

export default function App() {
  return (
    <div style={{ padding: 40 }}>
      <h2>React + Ant Design + dnd-kit 合并行整组拖动示例</h2>
      {/* <GroupedRowTable /> */}
      <GroupDragTable />
    </div>
  );
}

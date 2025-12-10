import type { WidgetConfig } from "@/types";

export interface GridLayoutItem extends WidgetConfig {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function generateLayout(widgets: WidgetConfig[], colNum: number): GridLayoutItem[] {
  const layout: GridLayoutItem[] = [];
  const matrix: boolean[][] = []; // true if occupied

  function isOccupied(x: number, y: number, w: number, h: number) {
    for (let i = x; i < x + w; i++) {
      for (let j = y; j < y + h; j++) {
        if (matrix[j]?.[i]) return true;
      }
    }
    return false;
  }

  function occupy(x: number, y: number, w: number, h: number) {
    for (let i = x; i < x + w; i++) {
      for (let j = y; j < y + h; j++) {
        if (!matrix[j]) matrix[j] = [];
        const row = matrix[j];
        if (row) row[i] = true;
      }
    }
  }

  // 分离已有位置和无位置的组件
  // 优先处理已有位置的组件，避免被新组件抢占位置导致重叠
  const positioned: WidgetConfig[] = [];
  const unpositioned: WidgetConfig[] = [];

  widgets.forEach((w) => {
    const width = w.w ?? w.colSpan ?? 1;
    // 只有当位置存在且在当前列数范围内时，才保留原位置
    // 否则视为无位置，重新排布（例如从宽屏切换到窄屏时）
    if (w.x !== undefined && w.y !== undefined && w.x + width <= colNum) {
      positioned.push(w);
    } else {
      unpositioned.push(w);
    }
  });

  // 1. 先放置已有位置的组件
  positioned.forEach((w) => {
    const width = w.w ?? w.colSpan ?? 1;
    const height = w.h ?? w.rowSpan ?? 1;

    // 如果位置已经被占用了（说明有组件重叠），
    // 或者虽然之前检查了宽度，但为了双重保险（例如 occupy 逻辑可能有变），
    // 这里再次检查占用情况。
    // 如果重叠，则降级为 unpositioned，由后续逻辑自动寻找空位。
    if (isOccupied(w.x!, w.y!, width, height)) {
      unpositioned.push(w);
      return;
    }

    occupy(w.x!, w.y!, width, height);
    layout.push({ ...w, i: w.id, w: width, h: height, x: w.x!, y: w.y! });
  });

  // 2. 再放置无位置（或位置失效、或因重叠被挤出）的组件
  unpositioned.forEach((w) => {
    const width = w.w ?? w.colSpan ?? 1;
    const height = w.h ?? w.rowSpan ?? 1;

    // Find first spot
    let x = 0;
    let y = 0;
    while (true) {
      if (x + width > colNum) {
        x = 0;
        y++;
        continue;
      }
      if (!isOccupied(x, y, width, height)) {
        occupy(x, y, width, height);
        layout.push({ ...w, i: w.id, x, y, w: width, h: height });
        break;
      }
      x++;
    }
  });

  return layout;
}

/**
 * 几何焦点导航 —— 移植自桌面版 `src/renderer/mainWindow/core/spatialFocus.ts`。
 *
 * 打分规则保持一致：主轴距离为主；与当前元素在交叉轴上**有重叠**的优先
 * （正对着的更符合直觉），没重叠的加大惩罚，避免「按一下 ↓ 跳到屏幕另一头」。
 *
 * 与桌面版的差异：
 *  - 候选元素来自焦点注册表（不是 DOM 选择器）
 *  - 坐标用 `measureInWindow` 取，异步，因此本模块整体是 async
 *  - 找不到目标时返回 null，由调用方决定「回落给系统 / 交回快捷键」
 */
import { FocusDirection, FocusRect } from "./registry";

/** 交叉轴没重叠时的惩罚基数（远大于任何正常距离） */
const NO_OVERLAP_PENALTY = 10000;

/** 主轴位移小于该值视为「没有移动」（避免在同一条线上反复横跳） */
const MIN_PRIMARY_DELTA = 1;

/** 交叉轴距离在总分中的权重 */
const CROSS_WEIGHT = 0.1;

/**
 * 在候选集合中找 `direction` 方向上最合适的下一个元素。
 *
 * @param currentId    当前焦点 id
 * @param direction    方向
 * @param rects        id → 屏幕坐标
 * @returns 目标 id；没有合适目标时返回 null
 */
export function findNextFocusId(
    currentId: string,
    direction: FocusDirection,
    rects: Map<string, FocusRect>,
): string | null {
    const current = rects.get(currentId);
    if (!current) {
        return null;
    }

    const cx = current.x + current.width / 2;
    const cy = current.y + current.height / 2;
    const vertical = direction === "up" || direction === "down";

    let bestId: string | null = null;
    let bestScore = Infinity;

    rects.forEach((rect, id) => {
        if (id === currentId) {
            return;
        }

        const dx = rect.x + rect.width / 2 - cx;
        const dy = rect.y + rect.height / 2 - cy;

        // 主轴：必须有位移，且确实在按下的方向上
        const primary =
            direction === "up"
                ? -dy
                : direction === "down"
                  ? dy
                  : direction === "left"
                    ? -dx
                    : dx;
        if (primary <= MIN_PRIMARY_DELTA) {
            return;
        }

        // 交叉轴重叠 = 正对着，优先
        const overlaps = vertical
            ? !(
                  rect.x + rect.width < current.x ||
                  rect.x > current.x + current.width
              )
            : !(
                  rect.y + rect.height < current.y ||
                  rect.y > current.y + current.height
              );
        const cross = vertical ? Math.abs(dx) : Math.abs(dy);

        const score =
            primary + (overlaps ? cross * CROSS_WEIGHT : NO_OVERLAP_PENALTY + cross);
        if (score < bestScore) {
            bestScore = score;
            bestId = id;
        }
    });

    return bestId;
}

/**
 * 当前元素没有焦点坐标时的兜底：取几何中心最靠近屏幕中心的元素。
 *
 * 用于「应用刚启动 / 焦点被列表复用清掉」时按任意方向键都能进入焦点体系。
 */
export function findInitialFocusId(rects: Map<string, FocusRect>): string | null {
    let bestId: string | null = null;
    let bestScore = Infinity;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    rects.forEach(rect => {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    });
    if (!isFinite(minX)) {
        return null;
    }
    const screenCx = (minX + maxX) / 2;
    const screenCy = (minY + maxY) / 2;

    rects.forEach((rect, id) => {
        const dx = rect.x + rect.width / 2 - screenCx;
        const dy = rect.y + rect.height / 2 - screenCy;
        const score = Math.sqrt(dx * dx + dy * dy);
        if (score < bestScore) {
            bestScore = score;
            bestId = id;
        }
    });

    return bestId;
}

/**
 * 找出某个矩形在指定方向上的邻居（用于列表边缘回落：
 * 列表内没有下一个 → 交给栏外元素，例如播放栏 / 侧栏）。
 */
export function findNeighborOutside(
    currentRect: FocusRect,
    direction: FocusDirection,
    rects: Map<string, FocusRect>,
    excludeIds: Set<string>,
): string | null {
    const cx = currentRect.x + currentRect.width / 2;
    const cy = currentRect.y + currentRect.height / 2;
    const vertical = direction === "up" || direction === "down";

    let bestId: string | null = null;
    let bestScore = Infinity;

    rects.forEach((rect, id) => {
        if (excludeIds.has(id)) {
            return;
        }
        const dx = rect.x + rect.width / 2 - cx;
        const dy = rect.y + rect.height / 2 - cy;
        const primary =
            direction === "up"
                ? -dy
                : direction === "down"
                  ? dy
                  : direction === "left"
                    ? -dx
                    : dx;
        if (primary <= MIN_PRIMARY_DELTA) {
            return;
        }
        const cross = vertical ? Math.abs(dx) : Math.abs(dy);
        const score = primary + cross * CROSS_WEIGHT;
        if (score < bestScore) {
            bestScore = score;
            bestId = id;
        }
    });

    return bestId;
}

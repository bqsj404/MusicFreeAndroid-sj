/**
 * 几何焦点导航的调度器。
 *
 * 判断顺序（与桌面版 `spatialFocus.ts` 的优先级一致）：
 *   1. 元素自己处理（滑条 / 输入框等，由它们注册更高优先级的按键处理器接管）
 *   2. 本模块：从当前焦点出发，按几何位置找该方向上最合适的元素
 *   3. 都没处理 → 返回 false，交回快捷键处理
 *
 * 组内优先：当前焦点属于某个「焦点组」（歌曲列表 / 播放栏 / 侧栏等）时，
 * 先按组内序号顺序移动，走到组边缘后再用几何算法跨组移动，
 * 避免长列表里「按 ↓ 跳到屏幕另一头」。
 */
import {
    FocusableItem,
    FocusDirection,
    FocusRect,
    getAllFocusables,
    getCurrentFocusId,
    getFocusable,
    measureAll,
    setCurrentFocusId,
} from "./registry";
import {
    findInitialFocusId,
    findNeighborOutside,
    findNextFocusId,
} from "./navigation";
import { keyboardLog } from "@/core/keyboard/native";

/** 语义键 → 方向 */
export const ARROW_DIRECTION: Record<string, FocusDirection | undefined> = {
    up: "up",
    down: "down",
    left: "left",
    right: "right",
};

/** 焦点组：一组「按序号顺序导航」的元素 */
const groups = new Map<string, { order: number }>();
let groupSeed = 0;

/**
 * 该元素所在组的导航方式。
 *
 * `sequence`：一维列表（歌曲列表 / 侧栏 / 设置项），↑↓ 按序号顺序移动
 * `grid`：二维网格（卡片列表），四个方向都按几何位置找最合适的邻居
 * 未登记时按 `grid` 处理（几何是通用兜底）
 */
export type FocusGroupLayout = "sequence" | "grid";

const groupLayouts = new Map<string, FocusGroupLayout>();

/** 注册一个焦点组（页面 / 面板挂载时调用） */
export function registerFocusGroup(
    group: string,
    layout: FocusGroupLayout = "grid",
) {
    if (!groups.has(group)) {
        groups.set(group, { order: ++groupSeed });
    }
    groupLayouts.set(group, layout);
    return () => {
        groups.delete(group);
        groupLayouts.delete(group);
    };
}

/** 取组的导航方式 */
export function getFocusGroupLayout(group: string): FocusGroupLayout {
    return groupLayouts.get(group) ?? "grid";
}

export function hasFocusGroup(group: string) {
    return groups.has(group);
}

export interface FocusMoveResult {
    /** 是否成功移动 */
    moved: boolean;
    /** 移动到的元素 id */
    targetId?: string;
}

/** 组内成员（按注册顺序） */
function getGroupMembers(group: string): FocusableItem[] {
    return getAllFocusables()
        .filter(item => item.group === group && item.navigable?.() !== false)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** 把焦点移动到指定元素 */
function focusItem(id: string): boolean {
    const item = getFocusable(id);
    if (!item) {
        return false;
    }
    item.focus();
    setCurrentFocusId(id);
    return true;
}

/**
 * 组内按序号顺序移动。
 *
 * @returns 是否移动成功（false = 已到组边缘，调用方继续尝试跨组逻辑）
 */
function moveInsideGroup(
    group: string,
    currentId: string,
    direction: FocusDirection,
): FocusMoveResult {
    const members = getGroupMembers(group);
    const currentPos = members.findIndex(_ => _.id === currentId);
    if (currentPos < 0) {
        return { moved: false };
    }

    const forward = direction === "down" || direction === "right";
    const target = forward ? members[currentPos + 1] : members[currentPos - 1];
    if (!target || target.id === currentId) {
        return { moved: false };
    }
    focusItem(target.id);
    return { moved: true, targetId: target.id };
}

/**
 * 计算并移动焦点。
 *
 * @param direction 方向
 * @returns 移动结果；`moved: false` 表示该方向没有目标，调用方可继续传递事件
 */
export async function moveFocus(
    direction: FocusDirection,
): Promise<FocusMoveResult> {
    const currentId = getCurrentFocusId();
    const rects = await measureAll();

    keyboardLog(
        "FocusMove",
        `${direction} current=${currentId ?? "-"} measured=${rects.size} registered=${getAllFocusables().length}`,
    );

    if (rects.size === 0) {
        return { moved: false };
    }

    // 还没有焦点（或焦点元素已被列表回收）→ 先进焦点体系
    if (!currentId || !rects.has(currentId)) {
        const initialId = findInitialFocusId(rects);
        if (!initialId) {
            return { moved: false };
        }
        focusItem(initialId);
        return { moved: true, targetId: initialId };
    }

    const currentItem = getFocusable(currentId);
    const layout = currentItem?.group
        ? getFocusGroupLayout(currentItem.group)
        : "grid";

    // 一维列表：↑↓ 走序号顺序；←→ 走几何（用于跳出列表去相邻栏位）
    const canUseSequence =
        layout === "sequence" && (direction === "up" || direction === "down");

    if (currentItem?.group && groups.has(currentItem.group) && canUseSequence) {
        const inGroup = moveInsideGroup(currentItem.group, currentId, direction);
        if (inGroup.moved) {
            return inGroup;
        }
    }

    // 2) 几何导航（跨组 / 组内跳格）
    const targetId = findNextFocusId(currentId, direction, rects);
    if (!targetId) {
        // 3) 兜底：跨组找「栏外邻居」（例如列表中 → 到播放栏）
        if (currentItem?.group) {
            return moveFocusOutsideGroup(currentItem.group, direction);
        }
        return { moved: false };
    }

    focusItem(targetId);
    return { moved: true, targetId };
}

/**
 * 把焦点组之外的元素作为候选，做一次几何移动。
 *
 * 例如歌曲列表按 ↓ 到底后继续按 ↓（或 →），焦点应移到播放栏 / 侧栏。
 */
export async function moveFocusOutsideGroup(
    excludeGroup: string,
    direction: FocusDirection,
): Promise<FocusMoveResult> {
    const currentId = getCurrentFocusId();
    if (!currentId) {
        return { moved: false };
    }
    const rects = await measureAll();
    const currentRect = rects.get(currentId);
    if (!currentRect) {
        return { moved: false };
    }
    const excludeIds = new Set(
        getGroupMembers(excludeGroup).map(item => item.id),
    );
    const targetId = findNeighborOutside(
        currentRect,
        direction,
        rects,
        excludeIds,
    );
    if (!targetId) {
        return { moved: false };
    }
    focusItem(targetId);
    return { moved: true, targetId };
}

/** 让焦点落到第一个可用元素（例如从触屏切到键盘时） */
export async function focusFirst(): Promise<FocusMoveResult> {
    const rects = await measureAll(true);
    const id = findInitialFocusId(rects);
    if (!id) {
        return { moved: false };
    }
    focusItem(id);
    return { moved: true, targetId: id };
}

/** 清空焦点组（测试或页面级重置） */
export function resetFocusGroups() {
    groups.clear();
}

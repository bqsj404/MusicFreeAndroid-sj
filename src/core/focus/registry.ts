/**
 * 焦点注册表 —— 硬件键盘 / 遥控器 / 手柄 的焦点导航基础设施。
 *
 * React Native 没有 DOM 的 `document.activeElement` 与选择器查询能力，
 * 因此这里自建一套最小可用的焦点模型：
 *
 *  - 每个可聚焦元素（列表项 / 按钮 / 侧栏项 / 播放栏控件）在挂载时注册自己，
 *    提供 `measure()`（取屏幕坐标）与 `focus()`（请求焦点）两个能力
 *  - 方向键按下时，用几何算法（见 `navigation.ts`）算出该方向上的下一个元素，
 *    再调用它的 `focus()`
 *  - 当前焦点 id 供 `Focusable` 渲染焦点环
 *
 * 与系统焦点的关系：`View` 的 `focusable` 属性仍然打开，静态布局由
 * `nextFocus*` 或本注册表二者其一接管，动态列表（FlatList / FlashList）
 * 复用 item 时以注册表为准，避免复用导致焦点丢失。
 */

/** 元素在屏幕上的矩形（单位与 measureInWindow 一致：像素） */
export interface FocusRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 焦点移动方向 */
export type FocusDirection = "up" | "down" | "left" | "right";

export interface FocusableItem {
    /** 稳定唯一 id */
    id: string;
    /** 所属焦点组（同组内可做 roving 处理），可选 */
    group?: string;
    /** 组内序号，可选（用于组内导航与滚动定位） */
    index?: number;
    /** 取元素在屏幕上的位置 */
    measure: () => Promise<FocusRect | null>;
    /** 请求该元素获得焦点 */
    focus: () => void;
    /** 是否参与几何导航（例如隐藏项传 false 可临时退出） */
    navigable?: () => boolean;
}

/** 坐标缓存有效期（毫秒）：长按连续移动时避免每帧 measure */
const MEASURE_CACHE_TTL = 1500;

let items = new Map<string, FocusableItem>();
let currentFocusId: string | null = null;
let measureCache: { at: number; map: Map<string, FocusRect> } | null = null;

const listeners = new Set<() => void>();

/** 快照版本号，供 useSyncExternalStore 判断是否需要重渲染 */
let version = 0;

function notify() {
    version += 1;
    listeners.forEach(listener => {
        try {
            listener();
        } catch (e) {
            console.warn("[Focus] listener error", e);
        }
    });
}

/** 注册一个可聚焦元素，返回注销函数 */
export function registerFocusable(item: FocusableItem) {
    items.set(item.id, item);
    invalidateMeasureCache();
    notify();
    return () => {
        if (items.get(item.id) === item) {
            items.delete(item.id);
        }
        if (currentFocusId === item.id) {
            currentFocusId = null;
        }
        invalidateMeasureCache();
        notify();
    };
}

/** 更新已注册元素的附加信息（组 / 序号等），不触发重渲染 */
export function updateFocusable(
    id: string,
    patch: Partial<Omit<FocusableItem, "id">>,
) {
    const item = items.get(id);
    if (item) {
        items.set(id, { ...item, ...patch });
    }
}

export function getFocusable(id: string): FocusableItem | undefined {
    return items.get(id);
}

export function getAllFocusables(): FocusableItem[] {
    return Array.from(items.values());
}

export function getFocusableCount(): number {
    return items.size;
}

/** 当前焦点 id（null 表示还没有任何元素获得过焦点） */
export function getCurrentFocusId(): string | null {
    return currentFocusId;
}

/** 设置当前焦点（由 Focusable 的 onFocus 回调调用） */
export function setCurrentFocusId(id: string | null) {
    if (currentFocusId === id) {
        return;
    }
    currentFocusId = id;
    notify();
}

/** 订阅焦点变化，返回取消函数 */
export function subscribeFocus(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 快照版本号（useSyncExternalStore 的 getSnapshot） */
export function getFocusVersion(): number {
    return version;
}

export function invalidateMeasureCache() {
    measureCache = null;
}

/**
 * 取所有可导航元素的屏幕坐标。
 *
 * 长按连续移动时会命中缓存；滚动、旋转、注册表变化都会让缓存失效。
 */
export async function measureAll(
    force = false,
): Promise<Map<string, FocusRect>> {
    const now = Date.now();
    if (!force && measureCache && now - measureCache.at < MEASURE_CACHE_TTL) {
        return measureCache.map;
    }

    const entries = Array.from(items.values()).filter(
        item => item.navigable?.() !== false,
    );
    const results = await Promise.all(
        entries.map(async item => {
            try {
                const rect = await item.measure();
                return [item.id, rect] as const;
            } catch (e) {
                return [item.id, null] as const;
            }
        }),
    );

    const map = new Map<string, FocusRect>();
    results.forEach(([id, rect]) => {
        if (rect && rect.width > 0 && rect.height > 0) {
            map.set(id, rect);
        }
    });
    measureCache = { at: now, map };
    return map;
}

import { Dimensions, unstable_batchedUpdates } from "react-native";
import { useEffect, useState } from "react";

/**
 * rpx 尺寸基准（**实时**）。
 *
 * 历史问题：基准在模块加载时一次性求值，旋转屏幕后不重算，
 * 导致横屏下所有用 `rpx()` 写死的尺寸仍按竖屏基准计算（布局错乱）。
 *
 * 现在改为：
 *  - 启动时读一次 `Dimensions`
 *  - 之后靠 `Dimensions.addEventListener("change")` 实时更新缓存
 *  - 需要「尺寸变化时重渲染」的组件用 `useWindowSize()` 订阅
 *
 * 说明：`rpx` 是普通函数（在 StyleSheet 外层也会被调用），
 * 因此只能用外部缓存而不是 hook。
 */
type IWindowSize = {
    width: number;
    height: number;
    /** 较短边 */
    minEdge: number;
    /** 较长边 */
    maxEdge: number;
};

function readWindowSize(): IWindowSize {
    const { width, height } = Dimensions.get("window");
    return {
        width,
        height,
        minEdge: Math.min(width, height),
        maxEdge: Math.max(width, height),
    };
}

let cached: IWindowSize = readWindowSize();
const listeners = new Set<(size: IWindowSize) => void>();

/**
 * 批量派发。
 *
 * 「方向 atom」与「根组件尺寸 state」都挂在这里的通知链上，
 * 若逐个同步触发会出现两次渲染与一次中间态（方向已变、尺寸未变），
 * 横屏切换时表现为一次可见的跳动。
 */
function notifyAll() {
    const run = () => {
        listeners.forEach(listener => {
            try {
                listener(cached);
            } catch (e) {
                console.warn("[rpx] listener error", e);
            }
        });
    };
    const batch = unstable_batchedUpdates as
        | ((cb: () => void) => void)
        | undefined;
    if (typeof batch === "function") {
        batch(run);
    } else {
        run();
    }
}

Dimensions.addEventListener("change", ({ window }) => {
    cached = {
        width: window.width,
        height: window.height,
        minEdge: Math.min(window.width, window.height),
        maxEdge: Math.max(window.width, window.height),
    };
    notifyAll();
});

/** 当前窗口尺寸（实时缓存） */
export function getWindowSize(): IWindowSize {
    return cached;
}

/** 订阅窗口尺寸变化 */
export function subscribeWindowSize(listener: (size: IWindowSize) => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * 订阅窗口尺寸的 Hook：屏幕旋转 / 分屏改变尺寸时触发重渲染。
 *
 * 凡是用 `rpx()` / `vh()` / `vw()` 写死尺寸、且需要跟随旋转重算的组件，
 * 都应当在顶层调用它。
 */
export function useWindowSize(): IWindowSize {
    const [size, setSize] = useState<IWindowSize>(cached);
    useEffect(() => {
        // 挂载时同步一次，避免读到过期值
        setSize(prev =>
            prev.width === cached.width && prev.height === cached.height
                ? prev
                : cached,
        );
        return subscribeWindowSize(setSize);
    }, []);
    return size;
}

/** 设计稿宽度 */
const DESIGN_WIDTH = 750;

/**
 * 把设计稿像素换算成当前屏幕像素（**实时**，旋转后自动跟随）。
 */
export default function (rpx: number) {
    return (rpx / DESIGN_WIDTH) * cached.minEdge;
}

export function vh(pct: number) {
    return (pct / 100) * cached.height;
}

export function vw(pct: number) {
    return (pct / 100) * cached.width;
}

export function vmin(pct: number) {
    return (pct / 100) * cached.minEdge;
}

export function vmax(pct: number) {
    return (pct / 100) * cached.maxEdge;
}

export function sh(pct: number) {
    return (pct / 100) * Dimensions.get("screen").height;
}

export function sw(pct: number) {
    return (pct / 100) * Dimensions.get("screen").width;
}

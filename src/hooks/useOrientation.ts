import { atom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { getWindowSize, subscribeWindowSize } from "@/utils/rpx";

type Orientation = "vertical" | "horizontal";

function resolveOrientation(size: {
    width: number;
    height: number;
}): Orientation {
    return size.width < size.height ? "vertical" : "horizontal";
}

/**
 * 方向 atom。
 *
 * 注意：初值必须**立即**按当前窗口算出来，不能写死 "vertical"。
 * 写死时横屏启动（或旋转后新建）的首帧会按竖屏渲染，出现一次布局跳动。
 */
const orientationAtom = atom<Orientation>(resolveOrientation(getWindowSize()));

/**
 * 监听屏幕方向变化（在 `BootstrapComponent` 里调用一次）。
 *
 * 数据源统一走 `@/utils/rpx` 的窗口尺寸订阅，避免与 `Dimensions`
 * 各监听一份导致时序不一致。
 */
export function useListenOrientationChange() {
    const setOrientationAtom = useSetAtom(orientationAtom);
    useEffect(() => {
        const sync = (size: { width: number; height: number }) => {
            setOrientationAtom(resolveOrientation(size));
        };
        // 挂载时按当前尺寸同步一次（覆盖「启动时横屏」的场景）
        sync(getWindowSize());
        return subscribeWindowSize(sync);
    }, [setOrientationAtom]);
}

export default function useOrientation() {
    return useAtomValue(orientationAtom);
}

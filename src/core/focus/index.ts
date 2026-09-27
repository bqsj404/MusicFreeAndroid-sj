/**
 * 焦点体系（硬件键盘 / TV 遥控器 / 游戏手柄通用）。
 *
 * 模块分层：
 *  - `registry.ts`    焦点注册表（元素注册、当前焦点、坐标测量）
 *  - `navigation.ts`  几何导航算法（移植自桌面版 spatialFocus.ts）
 *  - `controller.ts`  导航调度（组内顺序 → 几何跨组）
 *  - `hooks.ts`       React 绑定（useFocusable / useIsFocused）
 */
export * from "./registry";
export * from "./navigation";
export * from "./controller";
export * from "./hooks";
export { default as Focusable } from "./focusable";
export type { FocusableProps } from "./focusable";
export { default as FocusIconButton } from "./focusIconButton";
export type { FocusIconButtonProps } from "./focusIconButton";

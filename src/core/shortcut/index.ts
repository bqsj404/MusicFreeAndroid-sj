/**
 * 快捷键体系入口。
 *
 * 模块分层：
 *  - `actions.ts`  动作定义与默认键位
 *  - `store.ts`    键位映射的持久化与订阅
 *  - `runner.ts`   动作执行（播放类 + 由路由层注入的导航类）
 */
export * from "./actions";
export * from "./store";
export * from "./runner";

/**
 * 内建插件注册表（实例层）。
 *
 * 对齐桌面版 `BUILTIN_PLUGIN_HASHES = [本地, 云盘]` 的语义：
 * 内建插件随应用发布、不由用户安装，因此
 *  - 不进插件安装目录（`path` 是 `internal-plugin://` 伪路径）
 *  - 不进插件管理页（列表 / 计数过滤）
 *  - 不能被卸载 / 更新（批量更新与订阅更新都跳过）
 *  - 不进备份（备份只导出 `srcUrl`，内建插件没有 `srcUrl`）
 *
 * 模块分层（刻意避免循环依赖）：
 *  - 本文件只依赖 `@/constants`、`@/types` 与 `../plugin` 的**类型**
 *  - 插件实例由 `../plugin.ts` 在本模块加载完成后自行 `new Plugin(...)` 并注册，
 *    因此 `Plugin` 类与注册表的初始化顺序不冲突
 *  - `./cloudPlugin.ts` 只导出「定义工厂」，不依赖 `../plugin`
 */
import type { Plugin } from "../plugin";
import {
    builtinPluginHashes,
    builtinPluginPlatforms,
    cloudPluginHash,
    cloudPluginPlatform,
    isBuiltinPluginHash,
    isBuiltinPluginPlatform,
    localPluginHash,
    localPluginPlatform,
} from "@/constants/commonConst";

/** 内建插件的逻辑标识（platform 名同时是插件名） */
export interface IBuiltinPluginMeta {
    platform: string;
    /** 逻辑 hash 常量（实例的真实 hash 由 `Plugin` 构造函数计算） */
    hash: string;
}

const instances = new Map<string, Plugin>();
const metaByHash = new Map<string, IBuiltinPluginMeta>();

/**
 * 注册一个内建插件实例。
 *
 * @param instance `Plugin` 实例
 * @param meta     逻辑标识（platform / hash 常量）
 */
export function registerBuiltinPlugin(
    instance: Plugin,
    meta: IBuiltinPluginMeta,
): void {
    instances.set(meta.platform, instance);
    metaByHash.set(meta.hash, meta);
}

/** 全部内建插件实例 */
export function getBuiltinPlugins(): Plugin[] {
    return Array.from(instances.values());
}

/** 按平台名取内建插件实例 */
export function getBuiltinPluginByName(
    platform?: string | null,
): Plugin | undefined {
    if (!platform) {
        return undefined;
    }
    return instances.get(platform);
}

/** 按逻辑 hash 取内建插件实例 */
export function getBuiltinPluginByHash(
    hash?: string | null,
): Plugin | undefined {
    if (!hash) {
        return undefined;
    }
    const meta = metaByHash.get(hash);
    return meta ? instances.get(meta.platform) : undefined;
}

/** 是否已注册该平台名的内建插件 */
export function hasBuiltinPlugin(platform?: string | null): boolean {
    return !!platform && instances.has(platform);
}

/** 内建插件的逻辑 hash 列表 */
export function getBuiltinPluginHashes(): string[] {
    return [...builtinPluginHashes];
}

/** 内建插件的平台名列表 */
export function getBuiltinPluginPlatformsList(): string[] {
    return [...builtinPluginPlatforms];
}

export {
    builtinPluginHashes,
    builtinPluginPlatforms,
    cloudPluginHash,
    cloudPluginPlatform,
    isBuiltinPluginHash,
    isBuiltinPluginPlatform,
    localPluginHash,
    localPluginPlatform,
};

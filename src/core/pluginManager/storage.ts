import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";

/**
 * 插件 KV 存储（D17）。
 *
 * 通过插件运行时的 `env.storage` 暴露给插件（见 `plugin.ts` 的 `mountPlugin`），
 * 让插件有地方持久化自己的数据（缓存的 token、映射表等），
 * 而不必去动 MMKV 或文件系统。
 *
 * 约束：
 *  - **每个插件独立命名空间**，互不可见
 *  - **总量上限 10MB** —— 插件是第三方代码，不加限制的话
 *    一个写坏的插件就能把用户的存储写满
 *  - 只接受字符串值（与 Web Storage 语义一致，便于插件作者理解）
 */
const PLUGIN_STORAGE_LIMIT = 10 * 1024 * 1024;
const PLUGIN_STORAGE_LIMIT_MB = 10;

const store = getOrCreateMMKV("plugin.storage");

/** 命名空间键：每个插件一条记录，值是 `{ [key]: string }` */
function nsKeyOf(pluginName: string): string {
    return `${pluginName}.kv`;
}

function readNamespace(pluginName: string): Record<string, string> {
    try {
        const raw = store.getString(nsKeyOf(pluginName));
        const parsed = raw ? safeParse<Record<string, string>>(raw) : null;
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
    } catch (e) {
        // 读坏了就当空
    }
    return {};
}

function writeNamespace(pluginName: string, data: Record<string, string>) {
    store.set(nsKeyOf(pluginName), JSON.stringify(data));
}

/** 当前命名空间占用的字节数（按 UTF-8 粗算，键 + 值） */
function measure(data: Record<string, string>): number {
    let total = 0;
    Object.keys(data).forEach(key => {
        // 每字符最多 3 字节（中文），这里保守按 3 算
        total += (key.length + (data[key]?.length ?? 0)) * 3;
    });
    return total;
}

export interface IPluginStorage {
    getItem(key: string): string | null;
    /** 超限会抛错（插件可捕获） */
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
    getAllKeys(): string[];
    /** 当前占用（字节） */
    getSize(): number;
    /** 上限（字节） */
    getLimit(): number;
}

/** 为一个插件创建它的存储门面 */
export function createPluginStorage(pluginName: string): IPluginStorage {
    const assertWithinLimit = (data: Record<string, string>) => {
        const size = measure(data);
        if (size > PLUGIN_STORAGE_LIMIT) {
            throw new Error(
                `[plugin storage] 超出上限：${(size / 1024 / 1024).toFixed(2)}MB > ${PLUGIN_STORAGE_LIMIT_MB}MB`,
            );
        }
    };

    return {
        getItem(key: string) {
            if (typeof key !== "string" || !key) {
                return null;
            }
            const data = readNamespace(pluginName);
            return Object.prototype.hasOwnProperty.call(data, key)
                ? data[key]
                : null;
        },
        setItem(key: string, value: string) {
            if (typeof key !== "string" || !key) {
                throw new Error("[plugin storage] key 必须是非空字符串");
            }
            // 与 Web Storage 一致：值统一按字符串存
            const strValue = typeof value === "string" ? value : String(value);
            const data = readNamespace(pluginName);
            data[key] = strValue;
            assertWithinLimit(data);
            writeNamespace(pluginName, data);
        },
        removeItem(key: string) {
            const data = readNamespace(pluginName);
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                delete data[key];
                writeNamespace(pluginName, data);
            }
        },
        clear() {
            writeNamespace(pluginName, {});
        },
        getAllKeys() {
            return Object.keys(readNamespace(pluginName));
        },
        getSize() {
            return measure(readNamespace(pluginName));
        },
        getLimit() {
            return PLUGIN_STORAGE_LIMIT;
        },
    };
}

/** 清除某插件的全部存储（卸载插件时调用） */
export function clearPluginStorage(pluginName: string) {
    try {
        store.delete(nsKeyOf(pluginName));
    } catch (e) {
        // 忽略
    }
}

/** 所有插件占用的总字节数（设置页展示用） */
export function getPluginStorageTotalSize(pluginNames: string[]): number {
    return pluginNames.reduce(
        (sum, name) => sum + measure(readNamespace(name)),
        0,
    );
}

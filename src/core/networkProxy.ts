import { NativeModules } from "react-native";
import Config from "@/core/appConfig";
import { errorLog } from "@/utils/log";

/**
 * 网络代理（D16）。
 *
 * 代理**必须在原生层生效**：RN 的 `fetch`/axios 底层是 OkHttp，
 * JS 侧没有代理入口（axios 的 `proxy` 选项在 RN 上会被忽略）。
 * 所以这里只做三件事：读配置、调原生模块、在合适的时机应用。
 *
 * 配置键：
 *  - `network.proxy.enabled`
 *  - `network.proxy.host`
 *  - `network.proxy.port`
 */
interface INetworkProxyNative {
    setProxy(
        enabled: boolean,
        host: string,
        port: number,
    ): Promise<{ enabled: boolean; host: string; port: number }>;
    getProxy(): Promise<{ enabled: boolean; host: string; port: number }>;
}

const native = (NativeModules as { NetworkProxy?: INetworkProxyNative })
    .NetworkProxy;

/** 原生模块是否可用（未重新构建 APK 时会是 undefined） */
export function isProxySupported(): boolean {
    return !!native;
}

export function readProxyConfig(): {
    enabled: boolean;
    host: string;
    port: number;
} {
    const enabled = !!Config.getConfig("network.proxy.enabled");
    const host = String(Config.getConfig("network.proxy.host") ?? "").trim();
    const port = Number(Config.getConfig("network.proxy.port"));
    return {
        enabled,
        host,
        port: Number.isFinite(port) ? port : 0,
    };
}

/**
 * 把当前配置应用到原生层。
 *
 * 即使代理关闭也会调用一次 —— 这样"关掉代理"无需重启进程即可生效
 * （原生侧会重设工厂并重建 OkHttpClient）。
 *
 * @returns 是否成功应用
 */
export async function applyProxyConfig(): Promise<boolean> {
    if (!native) {
        return false;
    }
    const { enabled, host, port } = readProxyConfig();
    // 配置不完整时按"关闭"处理，避免把请求导到一个无效地址
    const effective = enabled && !!host && port > 0 && port <= 65535;
    try {
        await native.setProxy(effective, host, port);
        return true;
    } catch (e) {
        errorLog("applyProxyConfig", e);
        return false;
    }
}

/**
 * 应用并返回可读的结果描述。
 *
 * 供设置页做即时反馈 —— 用户改完配置能立刻知道是否真的生效。
 */
export async function applyProxyConfigWithResult(): Promise<{
    supported: boolean;
    applied: boolean;
    enabled: boolean;
    host: string;
    port: number;
}> {
    const { enabled, host, port } = readProxyConfig();
    const supported = isProxySupported();
    const applied = supported ? await applyProxyConfig() : false;
    return {
        supported,
        applied,
        enabled: enabled && !!host && port > 0,
        host,
        port,
    };
}

/**
 * 云盘（WebDAV）客户端与连接配置。
 *
 * 配置**复用「设置 → 备份」**里的三个键（与桌面版一致）：
 * `webdav.url` / `webdav.username` / `webdav.password`，任一为空即视为未配置。
 *
 * 认证方式固定为 HTTP Basic（`AuthType.Password`）。
 * 对「中国科技云数据胶囊」会额外带上 Zotero UA（见 `zoteroDavCompat`）。
 */
import { AuthType, WebDAVClient, createClient } from "webdav";
import Base64 from "@/utils/base64";
import Config from "@/core/appConfig";
import { davExtraHeaders, isZoteroOnlyDav } from "./zoteroDavCompat";

export interface ICloudDiskConfig {
    url: string;
    username: string;
    password: string;
}

/** 读取连接配置；未配置返回 null */
export function readCloudDiskConfig(): ICloudDiskConfig | null {
    const url = Config.getConfig("webdav.url");
    const username = Config.getConfig("webdav.username");
    const password = Config.getConfig("webdav.password");
    if (!url || !username || !password) {
        return null;
    }
    return { url, username, password };
}

/** 是否已配置云盘 */
export function isCloudDiskConfigured(): boolean {
    return readCloudDiskConfig() !== null;
}

/**
 * 创建客户端；未配置返回 null。
 *
 * 认证方式：**显式注入 `Authorization` 头**，而不是依赖库的
 * `authType: AuthType.Password`。
 *
 * 原因：在 React Native 运行时下，`webdav@5.7.0` 的
 * `AuthType.Password` 分支不会把 Basic 凭据放进请求（实测服务端返回 401），
 * 而同样的配置在 Node 下正常。改用 `AuthType.None` + 手动
 * `Authorization: Basic <base64>`（已实测可通），行为可控且与桌面版一致。
 */
export function createCloudDiskClient(): WebDAVClient | null {
    const config = readCloudDiskConfig();
    if (!config) {
        return null;
    }
    const headers: Record<string, string> = {
        Authorization: `Basic ${basicAuth(config.username, config.password)}`,
    };
    const extraHeaders = davExtraHeaders(config.url);
    if (extraHeaders) {
        Object.assign(headers, extraHeaders);
    }
    return createClient(config.url, {
        authType: AuthType.None,
        headers,
    });
}

/**
 * Basic 凭据（base64）。
 *
 * 用项目自带的 `@/utils/base64`，**不要用 `globalThis.btoa`**：
 * Hermes 运行时不保证提供 `btoa`，而这里若抛异常会被外层 try/catch 吞掉，
 * 表现为服务端一直返回 401（认证头根本没发出去）。
 */
export function basicAuth(username: string, password: string): string {
    return Base64.btoa(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`);
}

/** 把 baseURL 与远端路径拼成完整 URL（逐段编码） */
export function joinRemoteUrl(baseUrl: string, remotePath: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    const segments = remotePath
        .split("/")
        .filter(segment => segment.length > 0)
        .map(segment => encodeURIComponent(segment));
    return `${base}/${segments.join("/")}`;
}

/**
 * 播放时需要的请求头与 UA。
 *
 * 关键：目标服务要求的 Zotero UA 必须通过独立的 userAgent 字段传给播放器，
 * 不能塞进 headers。ExoPlayer 的 DefaultHttpDataSource.Factory 会先
 * setDefaultRequestProperties(headers) 再 setUserAgent(userAgent)，
 * 后者会覆盖 headers 里的 User-Agent；数据胶囊按 UA 判定客户端类型，
 * 被覆盖后返回 403 Client type mismatch（表现为列表能出、一播放就失败）。
 */
export function buildStreamHeaders(): {
    headers: Record<string, string>;
    userAgent?: string;
} | null {
    const config = readCloudDiskConfig();
    if (!config) {
        return null;
    }
    const headers: Record<string, string> = {
        Authorization: `Basic ${basicAuth(config.username, config.password)}`,
    };
    const zoteroUa = isZoteroOnlyDav(config.url)
        ? davExtraHeaders(config.url)?.["User-Agent"]
        : undefined;
    return zoteroUa ? { headers, userAgent: zoteroUa } : { headers };
}

/** 判断错误是否为「远端不存在」 */
export function isNotFoundError(e: any): boolean {
    if (!e) {
        return false;
    }
    const status =
        e.status ?? e.statusCode ?? e.response?.status ?? e.cause?.status;
    return status === 404;
}

export { isZoteroOnlyDav, davExtraHeaders };


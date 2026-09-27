/**
 * 云盘（WebDAV）音乐库核心能力。
 *
 * 与桌面版 `src/infra/cloudDisk/main/index.ts` 对齐，但只保留 Android 需要的部分：
 *  - 列目录（PROPFIND）→ 云盘歌曲条目
 *  - 播放地址（直链 + Basic Auth 请求头，**不需要本地回环代理**：
 *    Android 的 ExoPlayer 原生支持给数据源设置自定义头）
 *  - 同名匹配（按「作品键」精确匹配，歌手未知时才允许歌名唯一兜底）
 *  - 云盘歌词（两级匹配：精确文件名 → 归一化作品键扫目录）
 *
 * 远端目录约定（与备份共用根目录，见 `constant.ts`）：
 *   /MusicFree/music   音频，文件名 `<歌名> - <歌手>.ext`
 *   /MusicFree/lyrics  歌词，`<歌名> - <歌手>.lrc`
 */
import {
    CLOUD_LYRIC_DIR,
    CLOUD_MUSIC_DIR,
    LIST_CACHE_TTL_MS,
    LYRIC_INVALID_CHARS,
} from "./constant";
import {
    buildStreamHeaders,
    createCloudDiskClient,
    isNotFoundError,
    joinRemoteUrl,
    readCloudDiskConfig,
} from "./client";
import { toLogicalName, toStoredName } from "./zoteroDavCompat";
import { cloudPluginPlatform, supportLocalMediaType } from "@/constants/commonConst";

/** 远端文件（列表项） */
export interface ICloudRemoteFile {
    /** 远端**存储路径**（数据胶囊上是 `…_hash.ext.zip`），播放与操作都必须用它 */
    path: string;
    /** **逻辑名**（还原后的展示名，如 `晴天 - 周杰伦.mp3`） */
    name: string;
    /** 逻辑扩展名（小写，含点） */
    ext: string;
    size: number;
    mtime: number | null;
}

const AUDIO_EXT_SET = new Set(
    supportLocalMediaType.map(ext => ext.toLowerCase()),
);

/** 取扩展名（含点，小写） */
export function extname(fileName: string): string {
    const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
    const base = slash >= 0 ? fileName.slice(slash + 1) : fileName;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** 去扩展名 */
export function basenameWithoutExt(fileName: string): string {
    const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
    const base = slash >= 0 ? fileName.slice(slash + 1) : fileName;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
}

/** 取最后一个路径段 */
export function basename(remotePath: string): string {
    const slash = remotePath.lastIndexOf("/");
    return slash >= 0 ? remotePath.slice(slash + 1) : remotePath;
}

/**
 * 解析云端文件名：`<歌名> - <歌手>.<ext>`
 *
 * 注意：按**最后一个** ` - ` 分割 —— 歌名自身可能含 ` - `（与桌面版一致）。
 */
export function parseCloudFileName(
    fileName: string,
): { title: string; artist: string } {
    const ext = extname(fileName);
    const base = ext ? fileName.slice(0, -ext.length) : fileName;
    const idx = base.lastIndexOf(" - ");
    if (idx <= 0) {
        return { artist: "", title: base.trim() };
    }
    return {
        title: base.slice(0, idx).trim(),
        artist: base.slice(idx + 3).trim(),
    };
}

/** 归一化歌名（去空格、统一大小写、去常见修饰） */
export function normalizeTitleKey(title?: string | null): string {
    return (title ?? "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[（(].*?[）)]/g, "")
        .trim();
}

/** 归一化歌手（去空格、统一大小写） */
export function normalizeArtistKey(artist?: string | null): string {
    return (artist ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

/** 作品键：`歌名|歌手`（歌手缺失时只有歌名） */
export function buildMediaNameKey(
    title?: string | null,
    artist?: string | null,
): string {
    const t = normalizeTitleKey(title);
    const a = normalizeArtistKey(artist);
    if (!t) {
        return "";
    }
    return a ? `${t}|${a}` : t;
}

/** 歌词文件名净化 */
export function safeLyricFileName(name: string): string {
    const trimmed = (name ?? "").trim().replace(/\.lrc$/i, "");
    if (!trimmed) {
        return "";
    }
    return `${trimmed.replace(LYRIC_INVALID_CHARS, "_")}.lrc`;
}

/** 歌曲条目上的云盘扩展字段 */
export interface ICloudExtra {
    cloudPath: string;
    cloudName: string;
    cloudSize: number;
    cloudMtime: number | null;
    cloudExt: string;
}

/** 云盘歌曲条目：标准歌曲项 + 云盘扩展字段 */
export type ICloudMusicItem = IMusic.IMusicItem & ICloudExtra;

// ——— 列表缓存 ———

let cachedFiles: ICloudRemoteFile[] | null = null;
let cachedAt = 0;
let cachedByName = new Map<string, string>();
let cachedByTitle = new Map<string, string[]>();

/** 清空列表缓存（远端变更后调用） */
export function invalidateCloudCache() {
    cachedFiles = null;
    cachedAt = 0;
    cachedByName = new Map();
    cachedByTitle = new Map();
}

function buildNameIndex(files: ICloudRemoteFile[]) {
    cachedByName = new Map();
    cachedByTitle = new Map();
    files.forEach(file => {
        const { title, artist } = parseCloudFileName(file.name);
        const key = buildMediaNameKey(title, artist);
        if (key && !cachedByName.has(key)) {
            cachedByName.set(key, file.path);
        }
        const titleKey = normalizeTitleKey(title);
        if (titleKey) {
            const list = cachedByTitle.get(titleKey) ?? [];
            list.push(file.path);
            cachedByTitle.set(titleKey, list);
        }
    });
}

/**
 * 列出远端音频文件。
 *
 * @param force 忽略 60 秒缓存
 */
export async function listCloudFiles(
    force = false,
): Promise<ICloudRemoteFile[]> {
    const fresh =
        cachedFiles && Date.now() - cachedAt < LIST_CACHE_TTL_MS;
    if (!force && fresh) {
        return cachedFiles!;
    }

    const client = createCloudDiskClient();
    if (!client) {
        return [];
    }

    let contents: any[] = [];
    try {
        contents = (await client.getDirectoryContents(CLOUD_MUSIC_DIR)) as any[];
    } catch (e) {
        if (isNotFoundError(e)) {
            // 目录不存在 = 空列表，不算错误
            cachedFiles = [];
            cachedAt = Date.now();
            buildNameIndex([]);
            return [];
        }
        throw e;
    }

    const files: ICloudRemoteFile[] = (contents ?? [])
        .filter(entry => entry?.type === "file")
        .map(entry => {
            const storedName = String(
                entry.basename ?? basename(String(entry.filename ?? "")),
            );
            const rawPath = String(
                entry.filename ?? `${CLOUD_MUSIC_DIR}/${storedName}`,
            );
            return {
                path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
                name: toLogicalName(storedName),
                ext: extname(toLogicalName(storedName)),
                size: Number(entry.size ?? 0),
                mtime: entry.lastmod ? Date.parse(String(entry.lastmod)) : null,
            };
        })
        .filter(file => AUDIO_EXT_SET.has(file.ext))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    cachedFiles = files;
    cachedAt = Date.now();
    buildNameIndex(files);
    return files;
}

/**
 * 远端文件 → 歌曲条目。
 *
 * `id` 用**存储路径**（播放与远端操作都要用它）；
 * 展示用 `cloudName`（逻辑名）。
 */
export function buildCloudMusicItem(file: ICloudRemoteFile): ICloudMusicItem {
    const { title, artist } = parseCloudFileName(file.name);
    return {
        id: file.path,
        platform: cloudPluginPlatform,
        title: title || file.name,
        artist: artist || "未知歌手",
        album: "",
        artwork: "",
        duration: 0,
        cloudPath: file.path,
        cloudName: file.name,
        cloudSize: file.size,
        cloudMtime: file.mtime,
        cloudExt: file.ext,
    };
}

/** 列出全部云盘歌曲条目 */
export async function getCloudMusicItems(
    force = false,
): Promise<ICloudMusicItem[]> {
    const files = await listCloudFiles(force);
    return files.map(buildCloudMusicItem);
}

/**
 * 组装播放地址与请求头。
 *
 * Android 的 ExoPlayer 支持给数据源设置自定义请求头，
 * 因此这里返回「直链 + Authorization」，不需要桌面版那样的本地回环代理。
 *
 * @param remotePath 远端**存储路径**
 */
export function buildStreamSource(
    remotePath: string,
): { url: string; headers: Record<string, string>; userAgent?: string } | null {
    const config = readCloudDiskConfig();
    if (!config || !remotePath) {
        return null;
    }
    const source = buildStreamHeaders();
    if (!source) {
        return null;
    }
    return {
        url: joinRemoteUrl(config.url, remotePath),
        headers: source.headers,
        userAgent: source.userAgent,
    };
}

/**
 * 按歌曲信息找远端文件并组装播放地址。
 *
 * 匹配策略（与桌面版一致）：
 *  1. 作品键（歌名+歌手）精确匹配
 *  2. 仅当歌手缺失/未知时，允许「歌名唯一」兜底
 */
export async function resolveCloudStreamSource(
    musicItem: ICommon.IMediaBase,
): Promise<{
    url: string;
    headers: Record<string, string>;
    userAgent?: string;
} | null> {
    const extra = musicItem as ICommon.IMediaBase & Partial<ICloudExtra>;
    // 条目自带存储路径时直接用
    const directPath = extra.cloudPath || musicItem.id;
    if (directPath && /^\/MusicFree\//.test(String(directPath))) {
        const direct = buildStreamSource(String(directPath));
        if (direct) {
            return direct;
        }
    }

    await listCloudFiles();
    const title =
        (musicItem as IMusic.IMusicItem).title ?? parseCloudFileName(String(musicItem.id)).title;
    const artist = (musicItem as IMusic.IMusicItem).artist;

    const key = buildMediaNameKey(title, artist);
    let remotePath = key ? cachedByName.get(key) : undefined;

    if (!remotePath) {
        const artistKey = normalizeArtistKey(artist);
        const isUnknownArtist = !artistKey || artistKey === "未知歌手";
        if (isUnknownArtist) {
            const sameTitle = cachedByTitle.get(normalizeTitleKey(title));
            if (sameTitle?.length === 1) {
                remotePath = sameTitle[0];
            }
        }
    }

    if (!remotePath) {
        return null;
    }
    return buildStreamSource(remotePath);
}

// ——— 歌词 ———

/** 列出远端歌词文件 */
export async function listCloudLyricFiles(): Promise<ICloudRemoteFile[]> {
    const client = createCloudDiskClient();
    if (!client) {
        return [];
    }
    let contents: any[] = [];
    try {
        contents = (await client.getDirectoryContents(CLOUD_LYRIC_DIR)) as any[];
    } catch (e) {
        if (isNotFoundError(e)) {
            return [];
        }
        throw e;
    }
    return (contents ?? [])
        .filter(entry => entry?.type === "file")
        .map(entry => {
            const storedName = String(
                entry.basename ?? basename(String(entry.filename ?? "")),
            );
            const rawPath = String(
                entry.filename ?? `${CLOUD_LYRIC_DIR}/${storedName}`,
            );
            const name = toLogicalName(storedName);
            return {
                path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
                name,
                ext: extname(name),
                size: Number(entry.size ?? 0),
                mtime: entry.lastmod ? Date.parse(String(entry.lastmod)) : null,
            };
        })
        .filter(file => file.ext === ".lrc")
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

/**
 * 取云盘歌词文本。
 *
 * 两级匹配：精确文件名 → 归一化作品键扫目录（各插件歌手写法不同，需要兜底）。
 */
export async function getCloudLyricText(
    musicBase: ICommon.IMediaBase,
): Promise<string | null> {
    const client = createCloudDiskClient();
    if (!client) {
        return null;
    }
    const item = musicBase as IMusic.IMusicItem;
    const displayName = (item as any).cloudName
        ? basenameWithoutExt(String((item as any).cloudName))
        : item.title
          ? item.artist && item.artist !== "未知歌手"
              ? `${item.title} - ${item.artist}`
              : item.title
          : "";
    const fileName = safeLyricFileName(displayName);
    if (!fileName) {
        return null;
    }

    // ① 精确文件名
    try {
        const storedPath = `${CLOUD_LYRIC_DIR}/${toStoredName(fileName)}`;
        if (await client.exists(storedPath)) {
            const content = await client.getFileContents(storedPath, {
                format: "text",
            });
            return typeof content === "string" ? content : null;
        }
    } catch (e) {
        // 落到第二级
    }

    // ② 归一化作品键扫目录
    const parsed = parseCloudFileName(fileName);
    const wanted = buildMediaNameKey(parsed.title, parsed.artist);
    if (!wanted) {
        return null;
    }
    try {
        const files = await listCloudLyricFiles();
        const hit = files.find(file => {
            const p = parseCloudFileName(file.name);
            return buildMediaNameKey(p.title, p.artist) === wanted;
        });
        if (!hit) {
            return null;
        }
        const content = await client.getFileContents(hit.path, { format: "text" });
        return typeof content === "string" ? content : null;
    } catch (e) {
        return null;
    }
}

/** 云盘歌曲信息（封面等）——当前远端无封面约定，返回 null */
export async function getCloudMusicInfo(
    _musicBase: ICommon.IMediaBase,
): Promise<{ artwork?: string } | null> {
    return null;
}

/**
 * 云盘插件的取源入口（`builtin/cloudPlugin.ts` 调用）。
 *
 * 返回 `{ url, headers }`，由 `getMediaSource` 透传给播放器。
 */
export async function buildCloudMediaSource(
    musicItem: IMusic.IMusicItem,
    quality?: IMusic.IQualityKey,
) {
    if (quality && quality !== "standard") {
        return null;
    }
    const source = await resolveCloudStreamSource(musicItem);
    if (!source) {
        return null;
    }
    return {
        url: source.url,
        headers: source.headers,
        // UA 走独立字段：ExoPlayer 会用 setUserAgent 覆盖 headers 里的 User-Agent
        ...(source.userAgent ? { userAgent: source.userAgent } : {}),
    };
}


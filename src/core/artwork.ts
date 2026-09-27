import pathConst from "@/constants/pathConst";
import { toPlayableFileUrl } from "@/utils/fileUtils";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { copyFile, exists, mkdir, unlink } from "react-native-fs";
import CryptoJs from "crypto-js";

/**
 * 封面编辑（D14）。
 *
 * 桌面版播放页的封面支持「更换 / 恢复封面」；默认封面则是一张
 * **alpha mask**（只有墨迹形状、RGB 全黑、透明底），渲染时按主题色染色。
 *
 * Android 上：
 *  - **更换/恢复**：选图后把文件**复制进应用目录**再记录路径。不能直接存
 *    相册返回的 uri —— 那是临时授权，重启后多半读不到。
 *  - **默认封面染色**：RN 没有 CSS `currentColor`，但 SVG 可以直接吃
 *    `color`，所以默认封面用 SVG 图标 + 主题色实现（见 ThemedDefaultCover）。
 */
const ARTWORK_DIR = `${pathConst.basePath}/artwork/`;

/** 自定义封面的落盘路径：按条目唯一键命名，天然覆盖同名 */
function artworkPathOf(musicItem: IMusic.IMusicItem, ext: string): string {
    const hash = CryptoJs.MD5(
        getMediaUniqueKey(musicItem) ?? `${musicItem.platform}.${musicItem.id}`,
    ).toString(CryptoJs.enc.Hex);
    return `${ARTWORK_DIR}${hash}.${ext}`;
}

function extOf(uri: string): string {
    const clean = uri.split("?")[0];
    const idx = clean.lastIndexOf(".");
    const ext = idx >= 0 ? clean.slice(idx + 1).toLowerCase() : "";
    // 只接受常见图片扩展名，其余一律按 jpg 存
    return ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)
        ? ext
        : "jpg";
}

/** 去掉 `file://` 前缀（RNFS 多数接口吃纯路径） */
function toPlainPath(uri: string): string {
    return uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
}

/**
 * 取条目该显示的封面。
 *
 * 优先自定义封面；没有则回落到条目自带的 `artwork`（插件/标签里带的图）。
 * 两处都没有时返回 undefined，由调用方决定占位图。
 */
export function resolveArtwork(
    musicItem: IMusic.IMusicItem | null | undefined,
): string | undefined {
    if (!musicItem) {
        return undefined;
    }
    const custom = getMediaExtraProperty(musicItem, "artwork");
    if (custom && typeof custom === "string") {
        return toPlayableFileUrl(custom);
    }
    const own = musicItem.artwork?.trim?.();
    return own ? own : undefined;
}

/** 是否设置了自定义封面 */
export function hasCustomArtwork(
    musicItem: IMusic.IMusicItem | null | undefined,
): boolean {
    if (!musicItem) {
        return false;
    }
    const custom = getMediaExtraProperty(musicItem, "artwork");
    return !!(custom && typeof custom === "string");
}

/**
 * 设置自定义封面：把选中的图片复制进应用目录并记录。
 *
 * @param sourceUri 相册/文件选择器返回的 uri
 * @returns 落盘后的路径；失败时抛错
 */
export async function setCustomArtwork(
    musicItem: IMusic.IMusicItem,
    sourceUri: string,
): Promise<string> {
    if (!musicItem?.platform || !musicItem?.id) {
        throw new Error("无效的歌曲");
    }
    const dirExists = await exists(ARTWORK_DIR);
    if (!dirExists) {
        await mkdir(ARTWORK_DIR);
    }

    const target = artworkPathOf(musicItem, extOf(sourceUri));
    const to = toPlainPath(target);

    // 先清掉该条目所有旧封面（含其它扩展名），避免换格式后残留
    await Promise.all(
        ["jpg", "jpeg", "png", "webp", "gif", "bmp"].map(ext =>
            unlink(toPlainPath(artworkPathOf(musicItem, ext))).catch(() => {}),
        ),
    ).catch(() => {});

    await copyFile(toPlainPath(sourceUri), to);

    patchMediaExtra(musicItem, { artwork: target });
    return target;
}

/** 恢复默认封面：清掉记录并删除文件 */
export async function clearCustomArtwork(
    musicItem: IMusic.IMusicItem,
): Promise<void> {
    if (!musicItem?.platform || !musicItem?.id) {
        return;
    }
    await Promise.all(
        ["jpg", "jpeg", "png", "webp", "gif", "bmp"].map(ext =>
            unlink(toPlainPath(artworkPathOf(musicItem, ext))).catch(() => {}),
        ),
    ).catch(() => {});
    patchMediaExtra(musicItem, { artwork: undefined });
}




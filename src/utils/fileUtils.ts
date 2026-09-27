import pathConst from "@/constants/pathConst";
import FastImage from "react-native-fast-image";
import RNFS, {
    PicturesDirectoryPath,
    copyFile,
    downloadFile,
    exists,
    mkdir,
    readDir,
    unlink,
    writeFile,
} from "react-native-fs";
import { errorLog } from "./log";
import path from "path-browserify";
import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";

const galleryBasePath = `${PicturesDirectoryPath}/MusicFree/`;

/**
 * 将图片保存到相册
 * @param src 图片地址
 * @returns 保存后的文件路径
 */
export async function saveToGallery(src: string) {
    const fileName = `${galleryBasePath}${Date.now()}.png`;
    if (!(await exists(galleryBasePath))) {
        await mkdir(galleryBasePath);
    }
    if (await exists(src)) {
        try {
            await copyFile(src, fileName);
        } catch (e) {
            console.log("... ", e);
        }
    }
    if (src.startsWith("http")) {
        const { promise } = downloadFile({
            fromUrl: src,
            toFile: fileName,
            background: true,
        });
        await promise;
    }
    if (src.startsWith("data")) {
        await writeFile(fileName, src);
    }

    return fileName;
}

export function sizeFormatter(bytes: number | string) {
    if (typeof bytes === "string") {
        return bytes;
    }
    if (bytes === 0) {
        return "0B";
    }
    let k = 1024,
        sizes = ["B", "KB", "MB", "GB"],
        i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + sizes[i];
}

export async function checkAndCreateDir(dirPath: string) {
    const filePath = dirPath;
    try {
        if (!(await exists(filePath))) {
            await mkdir(filePath);
        }
    } catch (e) {
        errorLog("无法初始化目录", { path: dirPath, e });
    }
}

async function getFolderSize(dirPath: string): Promise<number> {
    let size = 0;
    try {
        const fns = await readDir(dirPath);
        for (let fn of fns) {
            if (fn.isFile()) {
                size += fn.size;
            }
            // todo: 可以改成并行 promise.all
            if (fn.isDirectory()) {
                size += await getFolderSize(fn.path);
            }
        }
    } catch {}
    return size;
}

export async function getCacheSize(
    type: "music" | "lyric" | "image",
): Promise<number> {
    if (type === "music") {
        return getFolderSize(pathConst.musicCachePath);
    } else if (type === "lyric") {
        return getFolderSize(pathConst.lrcCachePath);
    } else if (type === "image") {
        return getFolderSize(pathConst.imageCachePath);
    }
    throw new Error();
}

export async function clearCache(type: "music" | "lyric" | "image") {
    if (type === "music") {
        try {
            if (await exists(pathConst.musicCachePath)) {
                return unlink(pathConst.musicCachePath);
            }
        } catch {}
    } else if (type === "lyric") {
        try {
            const lrcs = readDir(pathConst.lrcCachePath);
            return Promise.all((await lrcs).map(_ => unlink(_.path)));
        } catch {}
    } else if (type === "image") {
        return FastImage.clearDiskCache();
    }
}

export function addFileScheme(fileName: string) {
    if (fileName.startsWith("/")) {
        return `file://${fileName}`;
    }
    return fileName;
}

/**
 * 转成**可交给播放器**的 file URL（会做百分号编码）。
 *
 * 为什么需要它：`addFileScheme` 只是简单拼 `file://`，不处理空格 / 中文 / `#` / `?`。
 * 这类路径交给 ExoPlayer 会因 URI 解析失败而播放报错
 * （日志里表现为 `MalformedURLException: unknown protocol: ...`），
 * 现象是「含空格或中文的本地文件点了没反应 / 直接 ERROR」。
 * 实测对比：`test-local.wav` 可播，`李白 - 李荣浩.wav` 必失败。
 *
 * **注意**：文件系统操作（`RNFS.exists` / `unlink` 等）仍必须用原始路径，
 * 所以没有改动 `addFileScheme`，只在「喂给播放器」的地方使用本函数。
 */
export function toPlayableFileUrl(fileName: string) {
    if (!fileName.startsWith("/")) {
        return fileName;
    }
    // encodeURI 会编码空格与中文，但不编码 `#` 与 `?` —— 这两个字符
    // 在文件名里合法、在 URL 里却是分隔符，必须单独处理。
    const encoded = encodeURI(fileName)
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3F");
    return `file://${encoded}`;
}

export function addRandomHash(url: string) {
    if (url.indexOf("#") === -1) {
        return `${url}#${Date.now()}`;
    }
    return url;
}

export function trimHash(url: string) {
    const index = url.lastIndexOf("#");
    if (index === -1) {
        return url;
    }
    return url.substring(0, index);
}

export function escapeCharacter(str?: string) {
    return str !== undefined ? `${str}`.replace(/[/|\\?*"<>:]+/g, "_") : "";
}

export function getDirectory(dirPath: string) {
    const lastSlash = dirPath.lastIndexOf("/");
    if (lastSlash === -1) {
        return dirPath;
    }
    return dirPath.slice(0, lastSlash);
}

export function getFileName(filePath: string, withoutExt?: boolean) {
    const lastSlash = filePath.lastIndexOf("/");
    if (lastSlash === -1) {
        return filePath;
    }
    let fileName = filePath.slice(lastSlash + 1);
    if (withoutExt) {
        const lastDot = fileName.lastIndexOf(".");
        fileName = lastDot === -1 ? fileName : fileName.slice(0, lastDot);
    }

    try {
        return decodeURIComponent(fileName);
    } catch {
        return fileName;
    }
}

export async function mkdirR(directory: string) {
    let folder = directory;
    const checkStack: string[] = [];
    while (folder.length > 15) {
        checkStack.push(folder);
        folder = path.dirname(folder);
    }
    let existPos = 0;
    for (let i = 0; i < checkStack.length; ++i) {
        const isExist = await exists(checkStack[i]);
        if (isExist) {
            existPos = i;
            break;
        }
    }

    for (let j = existPos - 1; j >= 0; --j) {
        try {
            await mkdir(checkStack[j]);
        } catch (e) {
            console.log("error", e);
        }
    }
}

export async function writeInChunks(
    filePath: string,
    data,
    chunkSize = 1024 * 1024 * 2,
) {
    let offset = 0;
    if (await exists(filePath)) {
        await unlink(filePath);
    }

    while (offset < data.length) {
        const chunk = data.slice(offset, offset + chunkSize);
        if (offset === 0) {
            await RNFS.writeFile(filePath, chunk, "utf8");
        } else {
            await RNFS.appendFile(filePath, chunk, "utf8");
        }
        offset += chunkSize;
    }
}


export function resolveImportedAssetOrPath(pathOrAsset: string | number | undefined) {
    return pathOrAsset === undefined
        ? undefined
        : typeof pathOrAsset === "string"
            ? pathOrAsset
            : resolveImportedAsset(pathOrAsset);
}

function resolveImportedAsset(id?: number) {
    return id
        ? (resolveAssetSource(id) as { uri: string } | null) ?? undefined
        : undefined;
}
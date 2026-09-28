/**
 * 文件路径 ↔ 可播放 URL 的纯函数集合。
 *
 * 为什么单独成文件：`fileUtils.ts` 顶部引入了 `react-native-fs`、
 * `react-native-fast-image` 等原生模块，jest 里无法直接 import；
 * 把这段纯逻辑抽出来才能被单测覆盖。`fileUtils.ts` 会原样 re-export，
 * 调用方无需改动。
 *
 * ## 这里修掉的是一个真实线上缺陷（第 7 批 · 问题 2）
 *
 * 旧实现只处理「以 `/` 开头的裸绝对路径」：
 *
 * ```ts
 * if (!fileName.startsWith("/")) { return fileName; }   // ← 编码分支永远进不去
 * ```
 *
 * 而全项目真正传进来的 localPath **一律是已经带 `file://` 前缀的**
 * （`addFileScheme` 加的，扫描入库与下载入库两条路都如此），
 * 它以 `f` 开头、不进 `/` 分支，于是**原样返回未编码的中文/空格路径**。
 * 交给 ExoPlayer 就是 `MalformedURLException: unknown protocol`，
 * 用户侧的表现是「下载好的歌点了没反应 / 直接报错」。
 *
 * `fileUtils.ts` 里那句实测注释
 * 「`test-local.wav` 可播、`李白 - 李荣浩.wav` 必失败」
 * 描述的正是这个现象 —— 只是当时没意识到失败样本恰好都带 `file://`，
 * 于是把锅记在了「文件名里有中文」上，而真正的分水岭是「有没有被编码」。
 */

/** `file://` 前缀 */
const FILE_SCHEME = "file://";

/**
 * 去掉 `file://` 前缀并做百分号解码，得到**文件系统口径**的普通路径。
 *
 * 注意：文件系统操作（`RNFS.exists` / `unlink` / `stat`）用这个结果；
 * 交给播放器的请用 [toPlayableFileUrl]。
 */
export function toPlainFilePath(path: string): string {
    if (!path) {
        return path;
    }
    const plain = path.startsWith(FILE_SCHEME)
        ? path.slice(FILE_SCHEME.length)
        : path;
    try {
        return decodeURIComponent(plain);
    } catch {
        // 文件名里含裸 `%` 时 decodeURIComponent 会抛，按原样返回
        return plain;
    }
}

/**
 * 转成**可交给播放器**的 `file://` URL（会做百分号编码）。
 *
 * 输入三种形态都支持，且对同一路径**幂等**（不会二次编码）：
 *  - `/storage/emulated/0/x/李白 - 李荣浩.mp3`（裸绝对路径）
 *  - `file:///storage/emulated/0/x/李白 - 李荣浩.mp3`（带前缀、未编码）
 *  - `file:///storage/emulated/0/x/%E6%9D%8E%E7%99%BD.mp3`（带前缀、已编码）
 *
 * 非本地路径（`http(s)://`、`content://`、`data:`…）原样返回。
 */
export function toPlayableFileUrl(fileName: string): string {
    if (!fileName) {
        return fileName;
    }

    let plain: string;
    if (fileName.startsWith(FILE_SCHEME)) {
        plain = fileName.slice(FILE_SCHEME.length);
    } else if (fileName.startsWith("/")) {
        plain = fileName;
    } else {
        // http(s) / content:// / data: / 相对路径 —— 都不是本地文件
        return fileName;
    }

    // `file://host/share` 这类带 authority 的形态不走本函数
    if (!plain.startsWith("/")) {
        return fileName;
    }

    // 先解码再编码，保证幂等：
    // 已编码路径 `%E6%9D%8E` → `李白` → `%E6%9D%8E`；
    // 若直接 encodeURI，会变成 `%25E6%259D%258E`（双重编码）。
    const decoded = toPlainFilePath(plain);

    // encodeURI 会编码空格与中文，但不编码 `#` 与 `?` ——
    // 这两个字符在文件名里合法、在 URL 里却是分隔符，必须单独处理。
    const encoded = encodeURI(decoded)
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3F");
    return `${FILE_SCHEME}${encoded}`;
}

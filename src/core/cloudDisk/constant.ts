/**
 * 云盘（WebDAV）模块常量。
 *
 * 远端目录布局与桌面版一致，且与「设置 → 备份」共用同一个根目录
 * （备份写 `/MusicFree/MusicFreeBackup.json`）。
 */

/** 根目录 */
export const CLOUD_ROOT_DIR = "/MusicFree";
/** 音频本体目录 */
export const CLOUD_MUSIC_DIR = "/MusicFree/music";
/** 回收站（删除只移动，不物理删除） */
export const CLOUD_TRASH_DIR = "/MusicFree/trash";
/** 歌词备份目录 */
export const CLOUD_LYRIC_DIR = "/MusicFree/lyrics";

/** 远端文件不存在的返回码 */
export const DAV_NOT_FOUND = 404;

/** 上传并发（桌面版备注：坚果云对并发敏感，取 2） */
export const UPLOAD_CONCURRENCY = 2;

/** 列表缓存时长（毫秒） */
export const LIST_CACHE_TTL_MS = 60 * 1000;

/** 回收站重名后缀最大尝试次数 */
export const TRASH_RENAME_MAX = 99;

/** 歌词文件名非法字符 */
export const LYRIC_INVALID_CHARS = /[\\/:*?"<>|]/g;

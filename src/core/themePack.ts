/**
 * 主题包（D6）。
 *
 * ## 为什么不是桌面版那套
 *
 * 桌面版的 `.mftheme` 是「`config.json` + `index.css`」，靠 **CSS 变量**
 * 驱动（`--color-bg-base` 之类），还能塞 iframe 动画背景。
 * **RN 没有 CSS**，这条路径在 Android 上不存在 —— 评估表对此的判断是
 * 「只能做**色板 JSON 主题包**」，本模块就是按这个口径做的。
 *
 * ## 格式
 *
 * ```json
 * {
 *   "name": "深夜蓝",
 *   "version": 1,
 *   "author": "…",          // 可选
 *   "description": "…",     // 可选
 *   "colors": { "primary": "#4A90D9", "text": "#E0E0E0", … }
 * }
 * ```
 *
 * 文件后缀建议 `.mftheme`（内容是 JSON），与桌面版的名字保持一致，
 * 便于用户理解"这是主题"；但它**不与桌面版主题包互相兼容**，
 * 解析时会明确说明这一点。
 *
 * ## 校验策略
 *
 * 宁可**拒绝**也不"尽力而为"：主题是全局生效的，一个错色值会让整个
 * 界面不可读，而用户很难判断是"主题就这样"还是"装坏了"。
 * 所以非法色值、未知键都会在安装时报错，并指出具体是哪一项。
 */

/** 可被主题包覆盖的颜色键（与 `core/theme.ts` 的 `configableColorKey` 一致） */
export const THEME_PACK_COLOR_KEYS = [
    "primary",
    "text",
    "appBar",
    "appBarText",
    "musicBar",
    "musicBarText",
    "pageBackground",
    "backdrop",
    "card",
    "placeholder",
    "tabBar",
    "notification",
] as const;

export type ThemePackColorKey = (typeof THEME_PACK_COLOR_KEYS)[number];

export interface IThemePack {
    name: string;
    version: number;
    author?: string;
    description?: string;
    colors: Partial<Record<ThemePackColorKey, string>>;
}

export interface IThemePackParseResult {
    pack: IThemePack | null;
    /** 失败原因（面向用户） */
    error?: string;
    /** 被忽略的未知键（不算错误，但值得提示） */
    ignoredKeys?: string[];
}

/** 主题包格式版本 */
export const THEME_PACK_VERSION = 1;
export const THEME_PACK_EXTENSION = "mftheme";

/**
 * 颜色值合法性：`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`。
 *
 * 只接受十六进制 —— 主题包会被跨设备传阅，`rgb()`、颜色名、
 * 甚至 `var(--x)` 这类写法在 RN 上的支持面并不一致，
 * 限制成十六进制可以保证"装上去就一定显示得出来"。
 */
export function isValidColor(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }
    const v = value.trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
        v,
    );
}

const KEY_SET = new Set<string>(THEME_PACK_COLOR_KEYS);

/**
 * 解析主题包文本。
 *
 * @param text JSON 文本（`.mftheme` 文件内容）
 */
export function parseThemePack(text?: string | null): IThemePackParseResult {
    if (!text || !text.trim()) {
        return { pack: null, error: "empty" };
    }
    let raw: any;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return { pack: null, error: "invalidJson" };
    }
    if (!raw || typeof raw !== "object") {
        return { pack: null, error: "invalidJson" };
    }
    // 桌面版主题包含 css 字段 —— 明确告知不兼容，而不是"装了个空主题"
    if (typeof raw.css === "string" || typeof raw.index === "string") {
        return { pack: null, error: "desktopThemePack" };
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
        return { pack: null, error: "missingName" };
    }
    const versionRaw = Number(raw.version);
    const version = Number.isFinite(versionRaw)
        ? versionRaw
        : THEME_PACK_VERSION;
    if (version > THEME_PACK_VERSION) {
        return { pack: null, error: "versionTooNew" };
    }

    const rawColors =
        raw.colors && typeof raw.colors === "object" ? raw.colors : null;
    if (!rawColors) {
        return { pack: null, error: "missingColors" };
    }

    const colors: Partial<Record<ThemePackColorKey, string>> = {};
    const ignoredKeys: string[] = [];
    let invalidKey: string | null = null;

    Object.keys(rawColors).forEach(key => {
        if (!KEY_SET.has(key)) {
            ignoredKeys.push(key);
            return;
        }
        const value = rawColors[key];
        if (value === undefined || value === null) {
            return;
        }
        if (!isValidColor(value)) {
            invalidKey = key;
            return;
        }
        colors[key as ThemePackColorKey] = String(value).trim();
    });

    if (invalidKey) {
        return { pack: null, error: `invalidColor:${invalidKey}` };
    }
    if (!Object.keys(colors).length) {
        return { pack: null, error: "noUsableColors" };
    }

    return {
        pack: {
            name,
            version,
            author: typeof raw.author === "string" ? raw.author : undefined,
            description:
                typeof raw.description === "string"
                    ? raw.description
                    : undefined,
            colors,
        },
        ignoredKeys: ignoredKeys.length ? ignoredKeys : undefined,
    };
}

/**
 * 从当前色板导出主题包文本。
 *
 * @param name 主题名
 * @param colors 当前色板（只会挑出可配置的那些键）
 */
export function buildThemePack(
    name: string,
    colors: Record<string, any>,
    extra?: { author?: string; description?: string },
): string {
    const picked: Record<string, string> = {};
    THEME_PACK_COLOR_KEYS.forEach(key => {
        const value = colors?.[key];
        if (isValidColor(value)) {
            picked[key] = String(value).trim();
        }
    });
    const pack: IThemePack = {
        name: name?.trim() || "未命名主题",
        version: THEME_PACK_VERSION,
        ...(extra?.author ? { author: extra.author } : {}),
        ...(extra?.description ? { description: extra.description } : {}),
        colors: picked,
    };
    return JSON.stringify(pack, null, 2);
}

/** 建议的文件名（带扩展名） */
export function themePackFileName(name: string): string {
    const safe = (name || "theme")
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 60)
        .trim();
    return `${safe || "theme"}.${THEME_PACK_EXTENSION}`;
}

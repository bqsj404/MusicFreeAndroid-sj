import React, { useCallback } from "react";
import ListItem, { ListItemHeader } from "@/components/base/listItem";
import { useI18N } from "@/core/i18n";
import Theme from "@/core/theme";
import {
    buildThemePack,
    parseThemePack,
    themePackFileName,
} from "@/core/themePack";
import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import { getDocumentAsync } from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system";

/**
 * 主题包（D6）。
 *
 * Android 上**没有 CSS**，所以桌面版那套「`config.json` + `index.css`」
 * 的主题包在这里不适用（评估表的判断是"只能做色板 JSON 主题包"）。
 * 这里提供导出/导入这一进一出：
 *
 *  - **导出**：把当前色板编成 `.mftheme`（JSON）复制到剪贴板
 *  - **导入**：选一个 `.mftheme` 文件，解析后落成一个自定义主题
 *
 * 导入走 `Theme.setTheme("custom-…", { colors })` 而**不是** `setColors` ——
 * 后者只在"当前已是自定义主题"时才生效（`p-light`/`p-dark` 会被直接跳过），
 * 那样用户在预设主题下导入会看到"完全没反应"。
 * `setTheme` 会一步切到自定义主题并以 darkTheme 为底合并色板。
 */
export default function ThemePackSection() {
    const { t } = useI18N();

    /** 把解析错误码翻成人话（含具体是哪个颜色键非法） */
    const errorText = useCallback(
        (error?: string) => {
            if (!error) {
                return t("themePack.err.unknown");
            }
            if (error.startsWith("invalidColor:")) {
                return t("themePack.err.invalidColor", {
                    key: error.slice("invalidColor:".length),
                });
            }
            const key = `themePack.err.${error}`;
            return t(key as any);
        },
        [t],
    );

    const onExport = useCallback(() => {
        const current = Theme.getTheme();
        const text = buildThemePack(
            current?.id && current.id.startsWith("custom-")
                ? current.id.slice("custom-".length)
                : t("themePack.defaultName"),
            current?.colors ?? {},
        );
        Clipboard.setString(text);
        Toast.success(
            t("themePack.exported", {
                name: themePackFileName(
                    t("themePack.defaultName"),
                ),
            }),
        );
    }, [t]);

    const onImport = useCallback(async () => {
        try {
            const result = await getDocumentAsync({
                copyToCacheDirectory: true,
                type: ["application/json", "text/plain", "*/*"],
            });
            if (result.canceled) {
                return;
            }
            const uri = result.assets?.[0]?.uri;
            if (!uri) {
                return;
            }
            const content = await readAsStringAsync(uri, { encoding: "utf8" });
            const parsed = parseThemePack(content);
            if (!parsed.pack) {
                Toast.warn(errorText(parsed.error));
                return;
            }
            Theme.setTheme(`custom-${parsed.pack.name}`, {
                colors: parsed.pack.colors,
            });
            Toast.success(
                t("themePack.imported", { name: parsed.pack.name }),
            );
        } catch (e: any) {
            Toast.warn(
                t("themePack.importFail", {
                    reason: e?.message ?? String(e),
                }),
            );
        }
    }, [t, errorText]);

    return (
        <>
            <ListItemHeader>{t("themePack.section")}</ListItemHeader>
            <ListItem withHorizontalPadding onPress={onExport}>
                <ListItem.Content
                    title={t("themePack.export")}
                    description={t("themePack.exportDesc")}
                />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onImport}>
                <ListItem.Content
                    title={t("themePack.import")}
                    description={t("themePack.importDesc")}
                />
            </ListItem>
        </>
    );
}

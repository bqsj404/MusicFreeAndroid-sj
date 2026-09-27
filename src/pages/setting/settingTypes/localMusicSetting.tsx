import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import ListItem, { ListItemHeader } from "@/components/base/listItem";
import { showPanel } from "@/components/panels/usePanel";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

/**
 * 本地音乐设置（D12）。
 *
 * 两项扫描期配置：
 *  - **排除目录**：前缀匹配，跳过录音/播客/有声书等不该入库的目录
 *  - **最短时长**：过滤提示音、试听碎片
 *
 * 两者都在「扫描/入库」时生效，改动后需要重新扫描才会反映到已有条目。
 */
export default function LocalMusicSetting() {
    const { t } = useI18N();
    const excludedPaths = useAppConfig("localMusic.excludedPaths") ?? [];
    const minDurationSec = useAppConfig("localMusic.minDurationSec") ?? 0;

    /** 排除目录：每行一个绝对路径 */
    function editExcludedPaths() {
        showPanel("SetUserVariables", {
            title: t("localMusicSetting.excludedPaths"),
            initValues: {
                paths: excludedPaths.join("\n"),
            },
            variables: [
                {
                    key: "paths",
                    name: t("localMusicSetting.excludedPathsHint"),
                    hint: t("localMusicSetting.excludedPathsPlaceholder"),
                },
            ],
            onOk(values, closePanel) {
                const list = String(values?.paths ?? "")
                    .split(/[\n,;，；]+/)
                    .map(v => v.trim())
                    .filter(Boolean);
                Config.setConfig(
                    "localMusic.excludedPaths",
                    list.length ? list : undefined,
                );
                Toast.success(t("toast.saveSuccess"));
                closePanel();
            },
        });
    }

    /** 最短时长（秒） */
    function editMinDuration() {
        showPanel("SetUserVariables", {
            title: t("localMusicSetting.minDuration"),
            initValues: {
                seconds: minDurationSec ? String(minDurationSec) : "",
            },
            variables: [
                {
                    key: "seconds",
                    name: t("localMusicSetting.minDurationHint"),
                    hint: "0",
                },
            ],
            onOk(values, closePanel) {
                const n = Number(String(values?.seconds ?? "").trim());
                Config.setConfig(
                    "localMusic.minDurationSec",
                    Number.isFinite(n) && n > 0 ? n : undefined,
                );
                Toast.success(t("toast.saveSuccess"));
                closePanel();
            },
        });
    }

    return (
        <ScrollView style={style.wrapper}>
            <ListItemHeader>
                {t("localMusicSetting.scanSection")}
            </ListItemHeader>

            <ListItem withHorizontalPadding onPress={editExcludedPaths}>
                <ListItem.Content
                    title={t("localMusicSetting.excludedPaths")}
                    description={
                        excludedPaths.length
                            ? t("localMusicSetting.excludedCount", {
                                  count: String(excludedPaths.length),
                              })
                            : t("localMusicSetting.notSet")
                    }
                />
            </ListItem>

            <ListItem withHorizontalPadding onPress={editMinDuration}>
                <ListItem.Content
                    title={t("localMusicSetting.minDuration")}
                    description={
                        minDurationSec
                            ? t("localMusicSetting.minDurationValue", {
                                  seconds: String(minDurationSec),
                              })
                            : t("localMusicSetting.notSet")
                    }
                />
            </ListItem>

            <ListItemHeader>
                {t("localMusicSetting.tipSection")}
            </ListItemHeader>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("localMusicSetting.rescanTip")}
                />
            </ListItem>
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});

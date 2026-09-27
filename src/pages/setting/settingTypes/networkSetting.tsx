import React, { useCallback } from "react";
import { ScrollView, StyleSheet } from "react-native";
import ListItem, { ListItemHeader } from "@/components/base/listItem";
import { showPanel } from "@/components/panels/usePanel";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import ThemeSwitch from "@/components/base/switch";
import Toast from "@/utils/toast";
import {
    applyProxyConfigWithResult,
    isProxySupported,
} from "@/core/networkProxy";

/**
 * 网络设置（D16）。
 *
 * 目前只有**代理**一项。代理在原生层生效（替换 OkHttpClient 的 Proxy），
 * 因为 RN 的 fetch/axios 没有 JS 侧代理入口 —— 见 `core/networkProxy.ts`
 * 与 `android/.../networkProxy/NetworkProxyModule.kt`。
 */
export default function NetworkSetting() {
    const { t } = useI18N();
    const enabled = useAppConfig("network.proxy.enabled") ?? false;
    const host = useAppConfig("network.proxy.host") ?? "";
    const port = useAppConfig("network.proxy.port") ?? 0;
    const supported = isProxySupported();

    /** 改动后立即应用到原生层，并给出可读反馈 */
    const applyAndReport = useCallback(async () => {
        const result = await applyProxyConfigWithResult();
        if (!result.supported) {
            Toast.warn(t("networkSetting.notSupported"));
            return;
        }
        if (result.enabled) {
            Toast.success(
                t("networkSetting.applied", {
                    host: result.host,
                    port: String(result.port),
                }),
            );
        } else {
            Toast.success(t("networkSetting.appliedOff"));
        }
    }, [t]);

    const editEndpoint = useCallback(() => {
        showPanel("SetUserVariables", {
            title: t("networkSetting.proxyEndpoint"),
            initValues: {
                host: host || "127.0.0.1",
                port: port ? String(port) : "7890",
            },
            variables: [
                {
                    key: "host",
                    name: t("networkSetting.proxyHost"),
                    hint: "127.0.0.1",
                },
                {
                    key: "port",
                    name: t("networkSetting.proxyPort"),
                    hint: "7890",
                },
            ],
            onOk(values, closePanel) {
                const h = String(values?.host ?? "").trim();
                const p = Number(String(values?.port ?? "").trim());
                Config.setConfig("network.proxy.host", h || undefined);
                Config.setConfig(
                    "network.proxy.port",
                    Number.isFinite(p) && p > 0 && p <= 65535 ? p : undefined,
                );
                closePanel();
                // 保存后立刻应用，避免"改了却没生效"
                applyAndReport();
            },
        });
    }, [host, port, t, applyAndReport]);

    return (
        <ScrollView style={style.wrapper}>
            <ListItemHeader>{t("networkSetting.section")}</ListItemHeader>

            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("networkSetting.proxyEnabled")}
                    description={
                        supported
                            ? t("networkSetting.proxyEnabledDesc")
                            : t("networkSetting.notSupported")
                    }
                />
                <ThemeSwitch
                    value={enabled}
                    onValueChange={value => {
                        Config.setConfig("network.proxy.enabled", value);
                        applyAndReport();
                    }}
                />
            </ListItem>

            <ListItem withHorizontalPadding onPress={editEndpoint}>
                <ListItem.Content
                    title={t("networkSetting.proxyEndpoint")}
                    description={
                        host && port > 0 ? `${host}:${port}` : t("common.notSet")
                    }
                />
            </ListItem>

            <ListItemHeader>{t("networkSetting.tipSection")}</ListItemHeader>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("networkSetting.scopeTip")}
                />
            </ListItem>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("networkSetting.rebuildTip")}
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

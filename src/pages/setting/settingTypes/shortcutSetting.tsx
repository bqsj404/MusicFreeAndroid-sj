import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showToast } from "@/components/base/toast";
import { useI18N } from "@/core/i18n";
import { useHardwareKeyPress, useKeyboardEnabled, getKeyBindingLabel } from "@/core/keyboard";
import {
    getActionKeys,
    isFocusReservedKey,
    rebindAction,
    resetShortcut,
    subscribeShortcut,
    getShortcutVersion,
    SHORTCUT_ACTIONS,
    type ShortcutActionId,
} from "@/core/shortcut";
import { registerFocusGroup, useFocusable } from "@/core/focus";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";

/** 设置页内的焦点组名（一维列表，↑↓ 按顺序移动） */
const FOCUS_GROUP = "shortcut-setting";

/**
 * 快捷键设置页。
 *
 * 交互：点某一项进入「捕获」状态 → 按下想绑定的键 → 立即生效并持久化。
 * 方向键 / 确认键 / Esc 被保留给焦点导航，不允许改绑（避免导航与动作打架）。
 */
export default function ShortcutSetting() {
    const { t } = useI18N();
    const colors = useColors();
    const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
    const [version, setVersion] = useState(0);

    // 让键盘体系保持启用，否则捕获不到按键
    useKeyboardEnabled();

    // 注册焦点组，让遥控器 / 键盘能在本页上下移动焦点
    useEffect(() => registerFocusGroup(FOCUS_GROUP, "sequence"), []);

    const resetFocusable = useFocusable({
        focusId: "shortcut-reset",
        group: FOCUS_GROUP,
        index: -1,
    });

    // 订阅配置变化，改绑后立即刷新
    useEffect(
        () => subscribeShortcut(() => setVersion(v => v + 1)),
        [],
    );
    void getShortcutVersion();
    void version;

    // 捕获按键：比全局快捷键优先级更高，且不向下传递
    useHardwareKeyPress(
        context => {
            if (!capturing) {
                return false;
            }
            const binding = context.binding;
            if (!binding) {
                return true; // 捕获期间吞掉所有未识别按键
            }
            if (isFocusReservedKey(binding)) {
                showToast({
                    type: "warn",
                    message: t("setting.shortcut.reserved", { key: getKeyBindingLabel(binding) }),
                });
                return true;
            }
            const owner = findOwner(binding, capturing);
            rebindAction(capturing, binding);
            setCapturing(null);
            if (owner) {
                showToast({
                    type: "warn",
                    message: t("setting.shortcut.overridden", {
                        key: getKeyBindingLabel(binding),
                        action: t(
                            `setting.shortcut.action.${owner}` as any,
                        ),
                    }),
                });
            } else {
                showToast({ type: "success", message: t("setting.shortcut.bound") });
            }
            return true;
        },
        [capturing, t],
        5,
        "ShortcutSetting.capture",
    );

    const items = useMemo(
        () =>
            SHORTCUT_ACTIONS.map(action => ({
                action,
                keys: getActionKeys(action.id),
            })),
        // version 变化时重算
        [version],
    );

    const onReset = useCallback(() => {
        resetShortcut();
        setCapturing(null);
        showToast({ type: "success", message: t("setting.shortcut.reset") });
    }, [t]);

    return (
        <ScrollView style={styles.wrapper} contentContainerStyle={styles.content}>
            <ThemeText fontSize="subTitle" fontColor="textSecondary" style={styles.hint}>
                {t("setting.shortcut.hint")}
            </ThemeText>

            <TouchableOpacity
                ref={resetFocusable.ref}
                focusable
                onFocus={resetFocusable.onFocus}
                onBlur={resetFocusable.onBlur}
                onPressIn={resetFocusable.onPressIn}
                style={[
                    styles.resetBtn,
                    { borderColor: colors.divider },
                    resetFocusable.focused
                        ? { borderColor: colors.primary, borderWidth: 2 }
                        : null,
                ]}
                onPress={onReset}>
                <ThemeText fontColor="primary">
                    {t("setting.shortcut.resetButton")}
                </ThemeText>
            </TouchableOpacity>
            {items.map(({ action, keys }, index) => {
                const isCapturing = capturing === action.id;
                const keyText = isCapturing
                    ? t("setting.shortcut.pressKey")
                    : keys.length
                      ? keys.map(getKeyBindingLabel).join(" / ")
                      : t("setting.shortcut.unbound");
                return (
                    <ListItem
                        key={action.id}
                        withHorizontalPadding
                        focusId={`shortcut-item-${index}`}
                        focusGroup={FOCUS_GROUP}
                        focusIndex={index}
                        onPress={() => {
                            if (!action.rebindable) {
                                return;
                            }
                            setCapturing(prev =>
                                prev === action.id ? null : action.id,
                            );
                        }}>
                        <ListItem.Content
                            title={t(
                                `setting.shortcut.action.${action.id}` as any,
                            )}
                        />
                        <View
                            style={[
                                styles.keyBadge,
                                {
                                    borderColor: isCapturing
                                        ? colors.primary
                                        : colors.divider,
                                    backgroundColor: isCapturing
                                        ? colors.listActive
                                        : "transparent",
                                },
                            ]}>
                            <ThemeText
                                fontSize="subTitle"
                                fontColor={isCapturing ? "primary" : "textSecondary"}>
                                {keyText}
                            </ThemeText>
                        </View>
                    </ListItem>
                );
            })}
        </ScrollView>
    );
}

/** 找出该键位当前被哪个动作占用（排除自身） */
function findOwner(
    binding: string,
    self: ShortcutActionId,
): ShortcutActionId | undefined {
    const found = SHORTCUT_ACTIONS.find(
        action => action.id !== self && getActionKeys(action.id).includes(binding),
    );
    return found?.id;
}

const styles = StyleSheet.create({
    wrapper: {
        flex: 1,
    },
    content: {
        paddingBottom: rpx(60),
    },
    hint: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(24),
        lineHeight: rpx(34),
    },
    keyBadge: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: rpx(8),
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(6),
        minWidth: rpx(120),
        alignItems: "center",
    },
    resetBtn: {
        marginBottom: rpx(32),
        marginHorizontal: rpx(24),
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: rpx(12),
        height: rpx(80),
        justifyContent: "center",
        alignItems: "center",
    },
});

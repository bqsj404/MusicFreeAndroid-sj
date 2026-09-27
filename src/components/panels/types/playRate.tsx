import React, { Fragment, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import { ScrollView } from "react-native-gesture-handler";
import { hidePanel } from "../usePanel";
import Divider from "@/components/base/divider";
import PanelHeader from "../base/panelHeader";
import { useI18N } from "@/core/i18n";

interface IPlayRateProps {
    /** 点击回调 */
    onRatePress: (rate: number) => void;
    /** 当前倍速（百分比整数），用于高亮与微调基准 */
    currentRate?: number;
}

/**
 * 倍速档位（D16）。
 *
 * 桌面版口径是 **0.25x ~ 3x、步进 0.05**；原先这里只有
 * `[50, 75, 100, 125, 150, 175, 200]` 七档（0.5x~2.0x）。
 * 现在按桌面版生成完整档位（25 ~ 300，共 56 档）。
 *
 * 内部一律用**百分比整数**表示（100 = 1.0x），与 `PersistStatus` 的
 * `music.rate` 及 `TrackPlayer.setRate(rate / 100)` 保持一致。
 */
const RATE_STEP = 5;
const RATE_MIN = 25;
const RATE_MAX = 300;

const RATES: number[] = Array.from(
    { length: Math.round((RATE_MAX - RATE_MIN) / RATE_STEP) + 1 },
    (_, i) => RATE_MIN + i * RATE_STEP,
);

/** 把任意倍速夹到合法区间并对齐到步进 */
export function normalizeRate(rate?: number): number {
    const n = Number(rate);
    if (!Number.isFinite(n)) {
        return 100;
    }
    const clamped = Math.min(Math.max(n, RATE_MIN), RATE_MAX);
    return Math.round(clamped / RATE_STEP) * RATE_STEP;
}

/** 倍速展示文本，例如 `1.25x`（去掉多余的 0） */
export function formatRate(rate: number): string {
    const value = (rate / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${value}x`;
}

export default function PlayRate(props: IPlayRateProps) {
    const { onRatePress, currentRate } = props ?? {};
    const i18n = useI18N();

    const safeAreaInsets = useSafeAreaInsets();
    const current = normalizeRate(currentRate);

    /** 微调：每次 ±1 步（0.05x）。56 档靠滚动找太费劲，给个步进入口 */
    const step = useMemo(
        () => (delta: number) => {
            const next = normalizeRate(current + delta * RATE_STEP);
            if (next !== current) {
                onRatePress(next);
            }
        },
        [current, onRatePress],
    );

    return (
        <PanelBase
            height={rpx(640)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={i18n.t("panel.playRate.title")}
                        hideButtons
                    />
                    <View style={style.currentRow}>
                        <Pressable
                            style={style.stepButton}
                            onPress={() => step(-1)}>
                            <ThemeText fontColor="primary">−0.05</ThemeText>
                        </Pressable>
                        <ThemeText fontSize="title" fontColor="primary">
                            {formatRate(current)}
                        </ThemeText>
                        <Pressable
                            style={style.stepButton}
                            onPress={() => step(1)}>
                            <ThemeText fontColor="primary">+0.05</ThemeText>
                        </Pressable>
                    </View>
                    <Divider />
                    <ScrollView
                        style={[
                            style.body,
                            { marginBottom: safeAreaInsets.bottom },
                        ]}>
                        {RATES.map(key => {
                            const active = key === current;
                            return (
                                <Fragment key={`frag-${key}`}>
                                    <Pressable
                                        key={`btn-${key}`}
                                        style={style.item}
                                        onPress={() => {
                                            onRatePress(key);
                                            hidePanel();
                                        }}>
                                        <ThemeText
                                            fontColor={
                                                active
                                                    ? "primary"
                                                    : "textSecondary"
                                            }>
                                            {formatRate(key)}
                                            {active ? "  ✓" : ""}
                                        </ThemeText>
                                    </Pressable>
                                </Fragment>
                            );
                        })}
                        <Divider />
                    </ScrollView>
                </>
            )}
        />
    );
}

const style = StyleSheet.create({
    body: {
        flex: 1,
        paddingHorizontal: rpx(24),
    },
    item: {
        height: rpx(96),
        justifyContent: "center",
    },
    currentRow: {
        width: rpx(750),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: rpx(60),
        paddingVertical: rpx(16),
    },
    stepButton: {
        paddingHorizontal: rpx(28),
        paddingVertical: rpx(12),
    },
});

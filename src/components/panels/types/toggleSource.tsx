import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import Loading from "@/components/base/loading";
import { hidePanel } from "../usePanel";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";
import PluginManager from "@/core/pluginManager";
import TrackPlayer from "@/core/trackPlayer";
import MusicSheet from "@/core/musicSheet";
import {
    SourceMatchLevel,
    isMatched,
    matchSourceLevel,
} from "@/core/sourceMatch";
import { getSourceName, resolveSourceKindByPlatform } from "@/core/mediaSource";
import Toast from "@/utils/toast";

interface IToggleSourceProps {
    musicItem: IMusic.IMusicItem;
    /** 选中后是否把歌单里这条引用也换掉（默认否，对齐「不替换原歌单信息」） */
    replaceSheet?: boolean;
}

interface ICandidate {
    item: IMusic.IMusicItem;
    level: SourceMatchLevel;
    pluginName: string;
}

/**
 * 单曲换源（D2）。
 *
 * 桌面版是「歌曲右键 → 更换来源」，弹窗内可选本地/云端/插件，插件侧搜索后由用户确认。
 * Android 上放在歌曲操作面板，打开即**并发搜索所有可搜索插件**，
 * 再用 D2 的**四级匹配规则**过滤、按级别排序，让用户自己挑。
 *
 * 为什么不让程序自动选：换源是"宁可找不到，也不该换错歌"的场景，
 * 而版本差异（Live / 翻唱 / 重录）靠规则未必分得清，最终判断交给用户最稳。
 */
export default function ToggleSource(props: IToggleSourceProps) {
    const { musicItem, replaceSheet = false } = props;
    const { t } = useI18N();
    const [candidates, setCandidates] = useState<ICandidate[]>([]);
    const [loading, setLoading] = useState(true);

    /** 匹配级别的可读名（按可信度递减） */
    const levelLabel = useCallback(
        (level: SourceMatchLevel) => {
            switch (level) {
                case SourceMatchLevel.Exact:
                    return t("panel.toggleSource.level.exact");
                case SourceMatchLevel.TitleExact:
                    return t("panel.toggleSource.level.titleExact");
                case SourceMatchLevel.MutualContains:
                    return t("panel.toggleSource.level.mutual");
                default:
                    return t("panel.toggleSource.level.loose");
            }
        },
        [t],
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const plugins = PluginManager.getSearchablePlugins("music");
            const keyword = musicItem?.alias || musicItem?.title || "";
            const collected: ICandidate[] = [];

            // 串行搜索：插件方法在沙箱里执行，并发过高容易卡顿
            for (const plugin of plugins) {
                if (cancelled || !keyword) {
                    break;
                }
                // eslint-disable-next-line no-await-in-loop
                const res = await plugin.methods
                    .search(keyword, 1, "music")
                    .catch(() => null);
                (res?.data ?? []).forEach((item: any) => {
                    // 自己那个插件的结果没必要列出来
                    if (item.platform === musicItem.platform) {
                        return;
                    }
                    const level = matchSourceLevel(musicItem, item);
                    if (!isMatched(level)) {
                        return;
                    }
                    collected.push({
                        item: item as IMusic.IMusicItem,
                        level,
                        pluginName: plugin.name,
                    });
                });
            }

            if (cancelled) {
                return;
            }
            collected.sort((a, b) => a.level - b.level);
            setCandidates(collected);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [musicItem]);

    const onPick = useCallback(
        async (candidate: ICandidate) => {
            try {
                await TrackPlayer.play(candidate.item);
                if (replaceSheet) {
                    MusicSheet.replaceMusicReference(musicItem, candidate.item);
                    Toast.success(t("panel.toggleSource.switchedAndReplaced"));
                } else {
                    Toast.success(t("panel.toggleSource.switched"));
                }
            } catch (e) {
                Toast.warn(t("panel.toggleSource.switchFail"));
            }
            hidePanel();
        },
        [musicItem, replaceSheet, t],
    );

    return (
        <PanelBase
            height={rpx(860)}
            renderBody={() => (
                <View style={style.wrapper}>
                    <PanelHeader
                        title={t("panel.toggleSource.title")}
                        hideButtons
                    />
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        style={style.subtitle}>
                        {`${musicItem?.title ?? ""}${
                            musicItem?.artist ? ` - ${musicItem.artist}` : ""
                        }`}
                    </ThemeText>
                    {loading ? (
                        <Loading />
                    ) : candidates.length === 0 ? (
                        <View style={style.empty}>
                            <ThemeText fontColor="textSecondary">
                                {t("panel.toggleSource.empty")}
                            </ThemeText>
                        </View>
                    ) : (
                        <ScrollView style={style.body}>
                            {candidates.map(candidate => {
                                const kind = resolveSourceKindByPlatform(
                                    candidate.item.platform,
                                );
                                const sourceName =
                                    getSourceName(
                                        kind,
                                        candidate.pluginName,
                                    ) || candidate.pluginName;
                                const duration =
                                    typeof candidate.item.duration ===
                                        "number" &&
                                    candidate.item.duration > 0
                                        ? ` · ${Math.round(
                                              candidate.item.duration,
                                          )}s`
                                        : "";
                                return (
                                    <ListItem
                                        key={`${candidate.item.platform}.${candidate.item.id}`}
                                        withHorizontalPadding
                                        onPress={() => onPick(candidate)}>
                                        <ListItem.Content
                                            title={candidate.item.title}
                                            description={`${
                                                candidate.item.artist ?? ""
                                            } · ${sourceName} · ${levelLabel(
                                                candidate.level,
                                            )}${duration}`}
                                        />
                                    </ListItem>
                                );
                            })}
                        </ScrollView>
                    )}
                </View>
            )}
        />
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        flex: 1,
    },
    subtitle: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(12),
    },
    body: {
        width: rpx(750),
        flex: 1,
    },
    empty: {
        paddingTop: rpx(80),
        alignItems: "center",
    },
});

import React, { useMemo } from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useCurrentMusic } from "@/core/trackPlayer";
import globalStyle from "@/constants/globalStyle";
import { View } from "react-native";
import Operations from "./operations";
import { showPanel } from "@/components/panels/usePanel.ts";
import { resolveArtwork } from "@/core/artwork";
import ThemedDefaultCover from "@/components/base/themedDefaultCover";

interface IProps {
    onTurnPageClick?: () => void;
}

export default function AlbumCover(props: IProps) {
    const { onTurnPageClick } = props;

    const musicItem = useCurrentMusic();
    const orientation = useOrientation();

    const artworkStyle = useMemo(() => {
        if (orientation === "vertical") {
            return {
                width: rpx(500),
                height: rpx(500),
            };
        } else {
            return {
                width: rpx(260),
                height: rpx(260),
            };
        }
    }, [orientation]);

    /**
     * D14：优先用自定义封面（mediaExtra.artwork），没有才用条目自带的。
     * 取不到时由 ThemedDefaultCover 顶上（按主题染色的默认封面）。
     */
    const artwork = resolveArtwork(musicItem);

    const longPress = Gesture.LongPress()
        .onStart(() => {
            if (artwork) {
                showPanel("ImageViewer", {
                    url: artwork,
                });
            }
        })
        .runOnJS(true);

    const tap = Gesture.Tap()
        .onStart(() => {
            onTurnPageClick?.();
        })
        .runOnJS(true);

    const combineGesture = Gesture.Race(tap, longPress);

    return (
        <>
            <GestureDetector gesture={combineGesture}>
                <View style={globalStyle.fullCenter}>
                    {artwork ? (
                        <FastImage
                            style={artworkStyle}
                            source={artwork}
                            placeholderSource={ImgAsset.albumDefault}
                        />
                    ) : (
                        <ThemedDefaultCover size={artworkStyle.width as number} />
                    )}
                </View>
            </GestureDetector>
            <Operations />
        </>
    );
}


/** 便捷：项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的全局 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
    toBeGreaterThan: (expected: number) => void;
};

import {
    AUTO_TOGGLE_COOLDOWN_MS,
    AUTO_TOGGLE_MAX_PLAY_ATTEMPTS,
    MAX_CONSECUTIVE_ERRORS,
    TOGGLE_SUCCESS_GRACE_MS,
    ToggleChainState,
    buildToggleGroupKey,
} from "../playErrorChain";

/**
 * D2 自动换源链的判定规则。
 *
 * 这些是"出问题就很难查"的部分：冷却失效会让错误事件开出多条链；
 * 去重口径不对会让同一个死源被反复重试；epoch 不生效则可能
 * 把用户刚切过去的歌掰回它自己那首。
 */
describe("buildToggleGroupKey", () => {
    it("同一首歌的不同来源会归到同一组", () => {
        const a = buildToggleGroupKey({
            title: "海底 (Live)",
            artist: "凤凰传奇",
        });
        const b = buildToggleGroupKey({
            title: "海底(Live)",
            artist: "凤凰传奇",
        });
        expect(a).toBe(b);
    });

    it("不同的歌不会归到同一组", () => {
        const a = buildToggleGroupKey({ title: "李白", artist: "李荣浩" });
        const b = buildToggleGroupKey({ title: "李白", artist: "王菲" });
        expect(a === b).toBe(false);
    });
});

describe("ToggleChainState", () => {
    it("冷却期内不允许开新链", () => {
        const state = new ToggleChainState();
        const t0 = 1_000_000;
        expect(state.tryStartChain(t0)).toBe(true);
        // 冷却期内
        expect(state.tryStartChain(t0 + AUTO_TOGGLE_COOLDOWN_MS - 1)).toBe(false);
        // 冷却过后
        expect(state.tryStartChain(t0 + AUTO_TOGGLE_COOLDOWN_MS + 1)).toBe(true);
    });

    it("链内尝试次数受上限约束", () => {
        const state = new ToggleChainState();
        state.tryStartChain(1_000_000);
        for (let i = 0; i < AUTO_TOGGLE_MAX_PLAY_ATTEMPTS; i++) {
            expect(state.canAttempt()).toBe(true);
            state.beginAttempt();
        }
        expect(state.canAttempt()).toBe(false);
    });

    it("epoch 随用户主动接管递增", () => {
        const state = new ToggleChainState();
        const before = state.getEpoch();
        const after = state.bumpEpoch();
        expect(after).toBe(before + 1);
    });

    it("已尝试的歌曲组键会被记住（换源后 id 变了也认得）", () => {
        const state = new ToggleChainState();
        const item = { title: "李白", artist: "李荣浩" };
        expect(state.hasTriedGroup(item)).toBe(false);
        state.markTriedGroup(item);
        expect(state.hasTriedGroup(item)).toBe(true);
        // 写法略有差异仍视为同一组
        expect(
            state.hasTriedGroup({ title: "李白", artist: "李荣浩 " }),
        ).toBe(true);
    });

    it("已尝试的插件不会重复搜索", () => {
        const state = new ToggleChainState();
        expect(state.hasTriedPlugin("插件A")).toBe(false);
        state.markTriedPlugin("插件A");
        expect(state.hasTriedPlugin("插件A")).toBe(true);
    });

    it("连续错误达到上限后应暂停", () => {
        const state = new ToggleChainState();
        for (let i = 1; i < MAX_CONSECUTIVE_ERRORS; i++) {
            expect(state.recordError()).toBe(false);
        }
        expect(state.recordError()).toBe(true);
    });

    it("换源成功后进入宽限期，且错误计数清零", () => {
        const state = new ToggleChainState();
        state.recordError();
        state.recordError();
        const now = 2_000_000;
        state.markToggleSuccess(now);
        expect(state.getConsecutiveErrors()).toBe(0);
        expect(state.inSuccessGrace(now + TOGGLE_SUCCESS_GRACE_MS - 1)).toBe(true);
        expect(state.inSuccessGrace(now + TOGGLE_SUCCESS_GRACE_MS + 1)).toBe(false);
    });

    it("用户停止换源后标记为 stopped", () => {
        const state = new ToggleChainState();
        expect(state.isStopped()).toBe(false);
        state.stop();
        expect(state.isStopped()).toBe(true);
    });

    it("切歌重置链内痕迹，但 epoch 继续累加", () => {
        const state = new ToggleChainState();
        state.tryStartChain(1_000_000);
        state.beginAttempt();
        state.markTriedPlugin("插件A");
        state.bumpEpoch();
        const epoch = state.getEpoch();

        state.resetForNewTrack();

        expect(state.getProgress().done).toBe(0);
        expect(state.hasTriedPlugin("插件A")).toBe(false);
        // epoch 不回退 —— 回退会让已作废的旧链重新"有效"
        expect(state.getEpoch()).toBe(epoch);
    });

    /**
     * 第 7 批 · 问题 3 的回归点。
     *
     * `resetForNewTrack` 是在 `skipToNext` 路径上被调用的，而 `skipToNext`
     * 又正是熔断前的兜底动作。若它顺手把连续错误清零，「一整张死源歌单」
     * 就会一直跳下去而永远到不了上限 —— 用户看到的就是
     * 「换源通知一直弹、播放的歌一直在切」。
     */
    it("切歌不得清掉连续错误计数（否则熔断永远不触发）", () => {
        const state = new ToggleChainState();
        state.recordError();
        state.recordError();
        expect(state.getConsecutiveErrors()).toBe(2);

        state.resetForNewTrack();

        // 关键：计数必须还留着，下一首再失败就该熔断
        expect(state.getConsecutiveErrors()).toBe(2);
        expect(state.recordError()).toBe(true);
    });

    it("冷却剩余时间随开链收敛到 0", () => {
        const state = new ToggleChainState();
        const start = 5_000_000;
        state.tryStartChain(start);
        expect(state.getRemainingCooldown(start)).toBe(AUTO_TOGGLE_COOLDOWN_MS);
        expect(
            state.getRemainingCooldown(start + AUTO_TOGGLE_COOLDOWN_MS - 1),
        ).toBe(1);
        expect(
            state.getRemainingCooldown(start + AUTO_TOGGLE_COOLDOWN_MS),
        ).toBe(0);
        expect(
            state.getRemainingCooldown(start + AUTO_TOGGLE_COOLDOWN_MS + 999),
        ).toBe(0);
    });
});

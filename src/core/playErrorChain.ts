import { buildMediaNameKey } from "./mediaNameKey";

/**
 * 自动换源链的状态（D2）。
 *
 * 桌面版 `trackPlayer.runAutoToggleChain` 的关键机制，这里抽成**纯逻辑**，
 * 与「怎么搜、怎么播」解耦 —— 那部分留在 `trackPlayer`（它才有 pluginManager），
 * 而 epoch / 冷却 / 已尝试 / 连续错误这些**判定规则**可以独立单测。
 *
 * 机制对照（见桌面版文档 5.5）：
 *
 * | 机制 | 值 | 为什么 |
 * |---|---|---|
 * | 冷却 | 2000ms | 错误事件可能密集触发，避免同时开多条链 |
 * | 链内最多尝试 | 3 次 | 防止一个死源把应用拖死 |
 * | 已尝试粒度 | **歌曲组键**（歌名+歌手归一化） | 换源后 id/platform 会变，按条目去重会重复试同一首 |
 * | 世代号 epoch | 用户主动接管即 +1 | 在途链立刻作废，绝不把用户刚切过去的歌掰回它自己那首 |
 * | 连续错误上限 | 3 次 | 超过则暂停，避免无限循环 |
 */

export const AUTO_TOGGLE_COOLDOWN_MS = 2000;
export const AUTO_TOGGLE_MAX_PLAY_ATTEMPTS = 3;
export const MAX_CONSECUTIVE_ERRORS = 3;
/** 刚换源成功后的宽限期：此时的 error 更可能是上一份源的残留 */
export const TOGGLE_SUCCESS_GRACE_MS = 5000;

/**
 * 歌曲组键：**歌名 + 歌手**归一化。
 *
 * 与 D3 的作品键同一套口径（复用 `buildMediaNameKey`），
 * 这样「同一首歌的不同来源」会被认成一组，换源尝试不会重复。
 */
export function buildToggleGroupKey(musicItem: unknown): string {
    const item = musicItem as { title?: string; artist?: string } | null;
    if (!item) {
        return "";
    }
    return buildMediaNameKey(item.title ?? "", item.artist ?? "");
}

/** 换源链的一次快照，便于 UI 展示「换源 done/total」 */
export interface IToggleProgress {
    /** 本次链里已尝试的次数 */
    done: number;
    /** 上限 */
    total: number;
    /** 当前尝试的目标描述（插件名 / 「云盘」） */
    target?: string;
}

export class ToggleChainState {
    /** 世代号：用户主动接管播放时 +1 */
    private epoch = 0;
    /** 上次开链时间（冷却用） */
    private lastChainAt = 0;
    /** 连续错误计数 */
    private consecutiveErrors = 0;
    /** 已尝试过的歌曲组键 */
    private triedGroupKeys = new Set<string>();
    /** 已尝试过的插件名 */
    private triedPlugins = new Set<string>();
    /** 是否被用户显式停止（停止后不再自动跳歌） */
    private stopped = false;
    /** 当前链内的尝试次数 */
    private attemptsInChain = 0;
    /** 上次换源成功的时间 */
    private lastToggleSuccessAt = 0;

    /** 用户主动接管播放（点歌 / 上下一首 / 停止换源 / 改队列） */
    bumpEpoch(): number {
        this.epoch += 1;
        return this.epoch;
    }

    getEpoch(): number {
        return this.epoch;
    }

    /** 是否处于冷却期（不可开新链） */
    inCooldown(now = Date.now()): boolean {
        return now - this.lastChainAt < AUTO_TOGGLE_COOLDOWN_MS;
    }

    /**
     * 尝试开一条新链。
     *
     * @returns 是否允许开；不允许时调用方应回退到 skip/pause 策略
     */
    tryStartChain(now = Date.now()): boolean {
        if (this.inCooldown(now)) {
            return false;
        }
        this.lastChainAt = now;
        this.attemptsInChain = 0;
        this.stopped = false;
        return true;
    }

    /** 链内还能再试吗（次数上限） */
    canAttempt(): boolean {
        return this.attemptsInChain < AUTO_TOGGLE_MAX_PLAY_ATTEMPTS;
    }

    /** 记一次尝试 */
    beginAttempt(): number {
        this.attemptsInChain += 1;
        return this.attemptsInChain;
    }

    /** 当前链的进度快照 */
    getProgress(target?: string): IToggleProgress {
        return {
            done: this.attemptsInChain,
            total: AUTO_TOGGLE_MAX_PLAY_ATTEMPTS,
            target,
        };
    }

    /** 这个歌曲组键试过了吗 */
    hasTriedGroup(musicItem: unknown): boolean {
        return this.triedGroupKeys.has(buildToggleGroupKey(musicItem));
    }

    /** 记下已试过的歌曲组键 */
    markTriedGroup(musicItem: unknown) {
        const key = buildToggleGroupKey(musicItem);
        if (key) {
            this.triedGroupKeys.add(key);
        }
    }

    /** 这个插件搜过了吗（串行搜索时跳过） */
    hasTriedPlugin(pluginName: string): boolean {
        return this.triedPlugins.has(pluginName);
    }

    /** 已试插件快照（传给搜索做排除，避免调用方直接改内部集合） */
    triedPluginsSnapshot(): Set<string> {
        return new Set(this.triedPlugins);
    }

    /** 已试歌曲组键快照 */
    triedGroupKeysSnapshot(): Set<string> {
        return new Set(this.triedGroupKeys);
    }

    markTriedPlugin(pluginName: string) {
        if (pluginName) {
            this.triedPlugins.add(pluginName);
        }
    }

    /** 换源成功 */
    markToggleSuccess(now = Date.now()) {
        this.lastToggleSuccessAt = now;
        this.consecutiveErrors = 0;
    }

    /** 刚换源成功不久？（此时的 error 可能是上一份源的残留） */
    inSuccessGrace(now = Date.now()): boolean {
        return now - this.lastToggleSuccessAt < TOGGLE_SUCCESS_GRACE_MS;
    }

    /** 记一次播放错误，返回是否已达上限 */
    recordError(): boolean {
        this.consecutiveErrors += 1;
        return this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS;
    }

    resetErrors() {
        this.consecutiveErrors = 0;
    }

    getConsecutiveErrors(): number {
        return this.consecutiveErrors;
    }

    /** 用户点了「停止换源」 */
    stop() {
        this.stopped = true;
    }

    isStopped(): boolean {
        return this.stopped;
    }

    /** 开始新一轮（切歌时调用，清掉链内痕迹但保留 epoch） */
    resetForNewTrack() {
        this.attemptsInChain = 0;
        this.triedGroupKeys.clear();
        this.triedPlugins.clear();
        this.stopped = false;
        this.resetErrors();
    }
}

export default new ToggleChainState();


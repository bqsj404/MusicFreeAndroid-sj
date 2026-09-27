package `fun`.upup.musicfree.keyboard

import android.view.KeyEvent

/**
 * 硬件按键的「谁拦谁放」策略。
 *
 * 目标：把方向键 / 媒体键 / 手柄键交给 JS 的焦点与快捷键体系处理，
 * 其余按键与系统行为（返回、音量、电源、输入法）原样放行。
 *
 * 三类输入设备的键码全部覆盖：
 *  - 物理键盘：方向键、字母数字、空格、回车、Esc、Tab、媒体键
 *  - Android TV 遥控器：DPAD_UP/DOWN/LEFT/RIGHT/CENTER（与键盘方向键同码）
 *  - 游戏手柄：DPAD_*、BUTTON_A/B/X/Y、L1/R1、L2/R2、START/SELECT、THUMBL/THUMBR
 *
 * 两类放行规则：
 *  - 文本编辑态（输入框有焦点）：一律放行，交回输入法与光标逻辑
 *  - 未登记的普通按键（含字母数字裸键）：放行，避免吞掉系统行为
 *    例外：字母数字键带 Ctrl / Alt 修饰时属于组合快捷键，需要拦截
 */
object KeyboardKeyPolicy {

    /** 文本编辑态下：一律放行，交回输入法与光标逻辑 */
    fun shouldHandleWhenEditing(keyCode: Int): Boolean = false

    /** 非编辑态下需要拦截并转发给 JS 的键（焦点移动 / 快捷键的可能键位） */
    private val HANDLED_KEY_CODES: Set<Int> = setOf(
        // —— 方向 / 确认（键盘方向键 + 遥控器 + 手柄 D-pad）——
        KeyEvent.KEYCODE_DPAD_UP,
        KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_DPAD_CENTER,
        KeyEvent.KEYCODE_ENTER,
        KeyEvent.KEYCODE_NUMPAD_ENTER,
        KeyEvent.KEYCODE_ESCAPE,
        KeyEvent.KEYCODE_MOVE_HOME,
        KeyEvent.KEYCODE_MOVE_END,
        KeyEvent.KEYCODE_PAGE_UP,
        KeyEvent.KEYCODE_PAGE_DOWN,
        KeyEvent.KEYCODE_SPACE,

        // —— 媒体键（耳机线控 / 键盘多媒体键 / 遥控器播放键）——
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_STOP,
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        KeyEvent.KEYCODE_MEDIA_REWIND,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,

        // —— 手柄按键 ——
        KeyEvent.KEYCODE_BUTTON_A,
        KeyEvent.KEYCODE_BUTTON_B,
        KeyEvent.KEYCODE_BUTTON_X,
        KeyEvent.KEYCODE_BUTTON_Y,
        KeyEvent.KEYCODE_BUTTON_L1,
        KeyEvent.KEYCODE_BUTTON_R1,
        KeyEvent.KEYCODE_BUTTON_L2,
        KeyEvent.KEYCODE_BUTTON_R2,
        KeyEvent.KEYCODE_BUTTON_START,
        KeyEvent.KEYCODE_BUTTON_SELECT,
        KeyEvent.KEYCODE_BUTTON_THUMBL,
        KeyEvent.KEYCODE_BUTTON_THUMBR,
    )

    /**
     * 是否需要拦截这个按键。
     *
     * @param keyCode 按键码
     * @param editing 是否处于文本编辑态
     * @param ctrl    Ctrl 是否按下
     * @param alt     Alt 是否按下
     */
    fun shouldHandle(
        keyCode: Int,
        editing: Boolean,
        ctrl: Boolean = false,
        alt: Boolean = false,
    ): Boolean {
        if (editing) {
            return shouldHandleWhenEditing(keyCode)
        }
        if (HANDLED_KEY_CODES.contains(keyCode)) {
            return true
        }
        // 字母 / 数字键只有在带 Ctrl 或 Alt 时才算组合快捷键（如 Ctrl+F），
        // 单独按下时放行，不影响正常输入与系统行为
        if (isPrintableKey(keyCode) && (ctrl || alt)) {
            return true
        }
        return false
    }

    /** 字母 / 数字等可打印键 */
    private fun isPrintableKey(keyCode: Int): Boolean {
        return ALPHA_KEY_CODES.contains(keyCode) ||
            (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9)
    }

    private val ALPHA_KEY_CODES: Set<Int> = setOf(
        KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_B, KeyEvent.KEYCODE_C,
        KeyEvent.KEYCODE_D, KeyEvent.KEYCODE_E, KeyEvent.KEYCODE_F,
        KeyEvent.KEYCODE_G, KeyEvent.KEYCODE_H, KeyEvent.KEYCODE_I,
        KeyEvent.KEYCODE_J, KeyEvent.KEYCODE_K, KeyEvent.KEYCODE_L,
        KeyEvent.KEYCODE_M, KeyEvent.KEYCODE_N, KeyEvent.KEYCODE_O,
        KeyEvent.KEYCODE_P, KeyEvent.KEYCODE_Q, KeyEvent.KEYCODE_R,
        KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_T, KeyEvent.KEYCODE_U,
        KeyEvent.KEYCODE_V, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_X,
        KeyEvent.KEYCODE_Y, KeyEvent.KEYCODE_Z,
    )
}

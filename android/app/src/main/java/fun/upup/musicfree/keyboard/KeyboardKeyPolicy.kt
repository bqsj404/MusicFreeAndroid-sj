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

    fun shouldHandle(keyCode: Int, editing: Boolean): Boolean {
        if (editing) {
            return shouldHandleWhenEditing(keyCode)
        }
        return HANDLED_KEY_CODES.contains(keyCode)
    }
}

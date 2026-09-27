package `fun`.upup.musicfree.networkProxy

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.net.InetSocketAddress
import java.net.Proxy

/**
 * 网络代理（D16）。
 *
 * ## 为什么必须放在原生
 *
 * RN 的 `fetch` / axios 底层走 OkHttp，**JS 侧没有任何代理入口**
 * （axios 的 `proxy` 选项在 RN 上会被忽略，因为它用的是 XHR 适配器）。
 * 唯一可行的位置是替换 OkHttpClient 的构造工厂。
 *
 * ## 实现要点
 *
 * - 用 `OkHttpClientProvider.createClientBuilder()` 取 **RN 默认的 builder**，
 *   只往上加 `proxy()`。若自己 `OkHttpClient.Builder()` 从零构造，
 *   会丢掉 RN 默认装配的拦截器（Cookie、gzip、网络事件上报等）。
 * - 改完工厂后必须 **重建并替换已缓存的 client**（`createClient()`），
 *   否则已经在用的那个 client 不会带上代理。
 * - 不启用代理时也要重设工厂（返回不带 proxy 的 builder），
 *   这样"关闭代理"能在不重启进程的情况下立即生效。
 */
class NetworkProxyModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    private val reactContext: ReactApplicationContext = context

    override fun getName() = "NetworkProxy"

    /** 当前是否启用代理（仅用于读取状态，持久化由 JS 侧负责） */
    private var proxyEnabled = false
    private var proxyHost: String? = null
    private var proxyPort: Int = 0

    /**
     * 设置 / 关闭代理。关闭时传 `enabled = false` 即可。
     *
     * @param enabled 是否启用
     * @param host    代理主机（如 `127.0.0.1`）
     * @param port    代理端口
     */
    @ReactMethod
    fun setProxy(enabled: Boolean, host: String?, port: Double, promise: Promise) {
        try {
            val portInt = port.toInt()
            proxyEnabled = enabled && !host.isNullOrBlank() && portInt in 1..65535
            proxyHost = host
            proxyPort = portInt

            applyProxyFactory()

            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("enabled", proxyEnabled)
                    putString("host", proxyHost ?: "")
                    putInt("port", proxyPort)
                }
            )
        } catch (e: Throwable) {
            promise.reject("PROXY_SET_FAILED", e.message, e)
        }
    }

    /** 读取当前生效的代理状态 */
    @ReactMethod
    fun getProxy(promise: Promise) {
        try {
            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("enabled", proxyEnabled)
                    putString("host", proxyHost ?: "")
                    putInt("port", proxyPort)
                }
            )
        } catch (e: Throwable) {
            promise.reject("PROXY_GET_FAILED", e.message, e)
        }
    }

    /** 安装工厂，并按需带上 proxy；随后重建缓存的 client 让改动立刻生效 */
    private fun applyProxyFactory() {
        OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
            override fun createNewNetworkModuleClient(): OkHttpClient {
                // 从 RN 默认 builder 出发，保留其默认拦截器
                val builder = OkHttpClientProvider.createClientBuilder()
                if (proxyEnabled) {
                    val h = proxyHost
                    if (!h.isNullOrBlank() && proxyPort > 0) {
                        builder.proxy(
                            Proxy(
                                Proxy.Type.HTTP,
                                InetSocketAddress.createUnresolved(h, proxyPort)
                            )
                        )
                    }
                }
                return builder.build()
            }
        })
        // 触发重建，替换掉已缓存的 client
        OkHttpClientProvider.createClient()
    }
}

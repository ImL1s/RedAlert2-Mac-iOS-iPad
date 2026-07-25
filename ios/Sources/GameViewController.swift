import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var contentProcessCrashCount = 0

    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true

        // Marker the web app uses to detect it is running inside the native shell.
        let bootstrap = WKUserScript(
            source: "window.__RA2_SHELL__ = { platform: 'ios', version: '0.1.0' };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bootstrap)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        // Opaque: the page always paints a black background, and transparency
        // costs alpha compositing on the full-screen GPU-process surface.
        webView.isOpaque = true
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        loadApp()
    }

    private func loadApp(crashed: Bool = false) {
        var urlString = "\(BundleSchemeHandler.scheme)://app/index.html"
        if crashed {
            // Let the web app know this boot follows a content-process kill so it
            // can surface it (memory pressure) instead of looking like a silent reset.
            urlString += "?crashRecovery=\(contentProcessCrashCount)"
        }
        webView.load(URLRequest(url: URL(string: urlString)!))
    }

    // The web content process was killed (almost always jetsam memory pressure
    // during game load). Without this handler the view goes blank/limbo; with a
    // plain reload the user silently loses their session. Reload and mark the
    // boot as crash recovery.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        contentProcessCrashCount += 1
        NSLog("[RA2] Web content process terminated (count=%d) — reloading", contentProcessCrashCount)
        loadApp(crashed: true)
    }
}

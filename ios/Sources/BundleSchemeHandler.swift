import WebKit
import UniformTypeIdentifiers

/// Serves the built web app (WebDist) and the imported game assets (GameRes)
/// out of the app bundle under the custom scheme `ra2app://app/...`.
///
/// Layout:
///   ra2app://app/<path>            -> Resources/WebDist/<path>
///   ra2app://app/gameres/<path>    -> Resources/GameRes/<path>
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "ra2app"

    private let webRoot: URL
    private let gameResRoot: URL

    override init() {
        let bundle = Bundle.main.resourceURL!
        webRoot = bundle.appendingPathComponent("WebDist", isDirectory: true)
        gameResRoot = bundle.appendingPathComponent("GameRes", isDirectory: true)
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        // Strip query strings vite appends for cache busting (?v=...)
        let relative = String(path.dropFirst())

        let fileURL: URL
        if relative.hasPrefix("gameres/") {
            fileURL = gameResRoot.appendingPathComponent(String(relative.dropFirst("gameres/".count)))
        } else {
            fileURL = webRoot.appendingPathComponent(relative)
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data("not found: \(relative)".utf8))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            respond(urlSchemeTask, url: url, status: 200, mime: mimeType(for: fileURL.pathExtension), data: data)
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Responses are delivered synchronously above; nothing to cancel.
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
        let headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "wasm": return "application/wasm"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "webm": return "video/webm"
        case "mp4": return "video/mp4"
        case "woff", "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "ini", "csf", "mix", "map", "mpr": return "application/octet-stream"
        default:
            if let ut = UTType(filenameExtension: ext), let mime = ut.preferredMIMEType {
                return mime
            }
            return "application/octet-stream"
        }
    }
}

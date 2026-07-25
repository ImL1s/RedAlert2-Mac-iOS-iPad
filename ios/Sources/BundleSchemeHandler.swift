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

    /// Files larger than this stream in chunks instead of a single didReceive —
    /// a one-shot 280MB payload is a peak-memory spike that can jetsam the web
    /// content process on iPhones during the first-launch seed.
    private static let streamThreshold = 8 * 1024 * 1024
    private static let chunkSize = 4 * 1024 * 1024

    private let webRoot: URL
    private let gameResRoot: URL
    private let ioQueue = DispatchQueue(label: "ra2.scheme.io", qos: .userInitiated)
    private var cancelledTasks = Set<ObjectIdentifier>()
    private let cancelLock = NSLock()

    override init() {
        let bundle = Bundle.main.resourceURL!
        webRoot = bundle.appendingPathComponent("WebDist", isDirectory: true)
        gameResRoot = bundle.appendingPathComponent("GameRes", isDirectory: true)
        super.init()
    }

    private func isCancelled(_ task: WKURLSchemeTask) -> Bool {
        cancelLock.lock(); defer { cancelLock.unlock() }
        return cancelledTasks.contains(ObjectIdentifier(task))
    }

    private func clearCancelled(_ task: WKURLSchemeTask) {
        cancelLock.lock(); defer { cancelLock.unlock() }
        cancelledTasks.remove(ObjectIdentifier(task))
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

        let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? nil
        let mime = mimeType(for: fileURL.pathExtension)

        if let size, size > Self.streamThreshold {
            streamFile(urlSchemeTask, url: url, fileURL: fileURL, size: size, mime: mime)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            respond(urlSchemeTask, url: url, status: 200, mime: mime, data: data)
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        cancelLock.lock()
        cancelledTasks.insert(ObjectIdentifier(urlSchemeTask))
        cancelLock.unlock()
    }

    /// Deliver a large file in bounded chunks. WebKit is only ever holding one
    /// chunk of IPC payload at a time instead of the whole archive.
    private func streamFile(_ task: WKURLSchemeTask, url: URL, fileURL: URL, size: Int, mime: String) {
        let headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": String(size),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)

        ioQueue.async { [weak self] in
            guard let self else { return }
            defer { self.clearCancelled(task) }
            guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
                DispatchQueue.main.async { task.didFailWithError(URLError(.cannotOpenFile)) }
                return
            }
            defer { try? handle.close() }
            var delivered = 0
            var stopped = false
            while delivered < size && !stopped {
                if self.isCancelled(task) { return }
                guard let chunk = try? handle.read(upToCount: Self.chunkSize), !chunk.isEmpty else { break }
                delivered += chunk.count
                let done = delivered >= size
                DispatchQueue.main.sync {
                    if self.isCancelled(task) { stopped = true; return }
                    task.didReceive(chunk)
                    if done { task.didFinish() }
                }
            }
            if stopped { return }
            if delivered < size {
                DispatchQueue.main.async {
                    if !self.isCancelled(task) { task.didFailWithError(URLError(.cannotLoadFromNetwork)) }
                }
            }
        }
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
